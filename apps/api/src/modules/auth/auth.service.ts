import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '@gamemarket/db';
import type { LoginInput, RegisterInput } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { MailService } from '../mail/mail.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './twofactor.service';
import { AttemptLimiter } from './attempts';

export interface RequestCtx {
  userAgent?: string;
  ip?: string;
  fingerprint?: string;
}

export interface IssuedAuth {
  /** roles — для ссылки на консоль сотрудника; доступ проверяет RolesGuard. */
  user: { id: string; email: string | null; username: string; roles: string[] };
  accessToken: string;
  refreshToken: string;
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

const BANNED = 'Аккаунт заблокирован. Если это ошибка — напишите в поддержку.';

/** Неверный пароль десять раз за 15 минут — пауза для этой почты. */
const passwordAttempts = new AttemptLimiter(10, 15 * 60_000);

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
    private readonly twoFactor: TwoFactorService,
    private readonly mail: MailService,
  ) {}

  async register(input: RegisterInput, ctx: RequestCtx): Promise<IssuedAuth> {
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { profile: { username: input.username } }] },
    });
    if (exists) throw new ConflictException('Пользователь с таким email или username уже есть');

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        profile: { create: { username: input.username, displayName: input.username } },
      },
      include: { profile: true },
    });

    if (user.email) {
      await this.sendVerification(user.id, user.email, user.profile!.username);
    }

    return this.issue(user.id, user.email, user.profile!.username, ctx);
  }

  private webUrl() {
    return process.env.WEB_URL ?? 'http://localhost:3000';
  }

  private async sendVerification(userId: string, email: string, username: string) {
    const token = this.tokens.signPurpose(userId, 'email_verify', 3 * 24 * 3600);
    const link = `${this.webUrl()}/verify-email?token=${encodeURIComponent(token)}`;
    await this.mail.send(
      email,
      'Подтвердите e-mail — GameMarket',
      `Здравствуйте, ${username}! Подтвердите e-mail: ${link}\nПокупки защищены эскроу.`,
    );
  }

  async verifyEmail(token: string): Promise<void> {
    let userId: string;
    try {
      userId = this.tokens.verifyPurpose(token, 'email_verify');
    } catch {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
  }

  /** Запрос сброса пароля. Всегда «успех» — без утечки существования e-mail. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { profile: true } });
    if (user?.email) {
      const token = this.tokens.signPurpose(user.id, 'pwd_reset', 3600);
      const link = `${this.webUrl()}/reset?token=${encodeURIComponent(token)}`;
      await this.mail.send(
        user.email,
        'Восстановление пароля — GameMarket',
        `Сброс пароля (ссылка действует 1 час): ${link}\nЕсли вы не запрашивали — проигнорируйте письмо.`,
      );
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    let userId: string;
    try {
      userId = this.tokens.verifyPurpose(token, 'pwd_reset');
    } catch {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.prisma.authSession.deleteMany({ where: { userId } });
  }

  async login(input: LoginInput, ctx: RequestCtx): Promise<IssuedAuth> {
    // Подбор пароля: перебор по почте упирается в паузу, а не в скорость сети.
    const key = input.email.trim().toLowerCase();
    const wait = passwordAttempts.wait(key);
    if (wait) {
      throw new HttpException(
        { statusCode: 429, message: `Слишком много попыток входа. Попробуйте через ${wait} мин.`, error: 'too_many_attempts' },
        429,
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { profile: true },
    });
    if (!user?.passwordHash || !user.profile) {
      passwordAttempts.fail(key);
      throw new UnauthorizedException('Неверные данные');
    }

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      passwordAttempts.fail(key);
      throw new UnauthorizedException('Неверные данные');
    }
    if (user.status === 'banned') throw new ForbiddenException(BANNED);

    // Пароль верный: форма различает «спросить код» и «код не подошёл».
    const second = await this.twoFactor.check(user.id, input.code);
    if (second !== 'ok') throw TwoFactorService.loginError(second);

    passwordAttempts.reset(key);
    return this.issue(user.id, user.email, user.profile.username, ctx);
  }

  /** Ротация refresh: проверка сессии, отзыв старой, выдача новой пары. */
  async refresh(refreshToken: string, ctx: RequestCtx): Promise<IssuedAuth> {
    const payload = (() => {
      try {
        return this.tokens.verifyRefresh(refreshToken);
      } catch {
        throw new UnauthorizedException('Невалидный refresh-токен');
      }
    })();

    const session = await this.prisma.authSession.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Сессия недействительна');
    }

    // Reuse detection: токен валиден по подписи, но не совпал с хранимым хэшем —
    // вероятна кража. Отзываем все активные сессии пользователя.
    if (session.refreshTokenHash !== sha256(refreshToken)) {
      await this.prisma.authSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Обнаружено повторное использование refresh-токена');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: { profile: true },
    });
    if (!user?.profile) throw new UnauthorizedException('Пользователь не найден');
    if (user.status === 'banned') throw new ForbiddenException(BANNED);

    // Сначала новая строка того же семейства, потом отзыв старой: запросы,
    // которые идут в этот момент со старым access-токеном, не получат 401.
    const issued = await this.issue(user.id, user.email, user.profile.username, ctx, session.familyId);
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return issued;
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    try {
      const { sid } = this.tokens.verifyRefresh(refreshToken);
      await this.prisma.authSession.updateMany({
        where: { id: sid, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      /* токен уже невалиден — нечего отзывать */
    }
  }

  /** Новый вход — новое семейство сеанса; обновление токенов продолжает прежнее. */
  private async issue(
    userId: string,
    email: string | null,
    username: string,
    ctx: RequestCtx,
    familyId?: string,
  ): Promise<IssuedAuth> {
    const sid = randomUUID();
    const family = familyId ?? sid;
    const accessToken = this.tokens.signAccess({ sub: userId, username, fam: family });
    const refreshToken = this.tokens.signRefresh({ sub: userId, sid });
    const ttl = Number(process.env.JWT_REFRESH_TTL ?? 2592000);

    await this.prisma.authSession.create({
      data: {
        id: sid,
        userId,
        familyId: family,
        refreshTokenHash: sha256(refreshToken),
        userAgent: ctx.userAgent,
        ip: ctx.ip,
        fingerprint: ctx.fingerprint,
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });

    const roles = await this.rolesOf(userId);
    return { user: { id: userId, email, username, roles }, accessToken, refreshToken };
  }

  // ── Пароль и сеансы из кабинета ──

  /**
   * Смена пароля: нужен текущий. Остальные устройства выходят сразу —
   * смену пароля делают, когда подозревают чужой вход.
   */
  async changePassword(userId: string, current: string, next: string, keepFamily?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, email: true } });
    if (!user?.passwordHash) {
      throw new BadRequestException('У аккаунта нет пароля — задайте его через «Забыли пароль»');
    }
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new BadRequestException('Текущий пароль неверный');
    if (current === next) throw new BadRequestException('Новый пароль совпадает с текущим');
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, 12) } });
    const closed = await this.closeSessions(userId, keepFamily);
    if (user.email && this.mail.enabled) {
      await this.mail.send(
        user.email,
        'Пароль изменён',
        'Пароль от GameMarket изменён, другие устройства вышли из аккаунта. Если это были не вы — восстановите доступ через «Забыли пароль».',
      );
    }
    return { ok: true, closedSessions: closed };
  }

  /** Активные входы: устройство, адрес, когда вошли. Текущий помечен. */
  async sessions(userId: string, currentFamily?: string) {
    const rows = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { familyId: true, userAgent: true, ip: true, createdAt: true },
    });
    // Время входа — у первой строки семейства, а не у последнего обновления токенов.
    const firsts = await this.prisma.authSession.findMany({
      where: { familyId: { in: rows.map((r) => r.familyId) } },
      orderBy: { createdAt: 'asc' },
      distinct: ['familyId'],
      select: { familyId: true, createdAt: true },
    });
    const since = new Map(firsts.map((f) => [f.familyId, f.createdAt]));
    return rows.map((r) => ({
      id: r.familyId,
      userAgent: r.userAgent,
      ip: r.ip,
      signedInAt: since.get(r.familyId) ?? r.createdAt,
      lastActiveAt: r.createdAt,
      current: r.familyId === currentFamily,
    }));
  }

  async revokeSession(userId: string, familyId: string, currentFamily?: string) {
    if (familyId === currentFamily) {
      throw new BadRequestException('Это текущий сеанс — чтобы выйти на этом устройстве, нажмите «Выйти»');
    }
    const res = await this.prisma.authSession.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!res.count) throw new BadRequestException('Сеанс уже завершён');
    return { ok: true };
  }

  async revokeOtherSessions(userId: string, currentFamily?: string) {
    return { ok: true, closedSessions: await this.closeSessions(userId, currentFamily) };
  }

  private async closeSessions(userId: string, keepFamily?: string): Promise<number> {
    const res = await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null, ...(keepFamily ? { familyId: { not: keepFamily } } : {}) },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  /** Ключи ролей пользователя: «admin», «moderator»… */
  async rolesOf(userId: string): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({ where: { userId }, select: { role: { select: { key: true } } } });
    return rows.map((r) => r.role.key);
  }
}
