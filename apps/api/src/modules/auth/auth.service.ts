import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '@gamemarket/db';
import { deviceOf, type LoginInput, type RegisterInput } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './twofactor.service';
import { AttemptLimiter } from './attempts';
import { langOf, say } from '../../i18n/texts';
import type { Lang } from '../../i18n/lang';

export interface RequestCtx {
  userAgent?: string;
  ip?: string;
  fingerprint?: string;
  /** Язык сайта из Accept-Language: им пишутся письма и уведомления. */
  lang?: Lang;
}

export interface IssuedAuth {
  /** roles — для ссылки на консоль сотрудника; доступ проверяет RolesGuard. */
  user: { id: string; email: string | null; username: string; roles: string[] };
  accessToken: string;
  refreshToken: string;
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

const BANNED = 'Аккаунт заблокирован. Если это ошибка — напишите в поддержку.';

/** Устройство «знакомое», если с него входили за столько дней. */
export const KNOWN_DEVICE_DAYS = 180;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ссылка «Это не я» из письма о смене пароля живёт сутки: письмо читают не сразу. */
export const NOT_ME_RESET_TTL = 86_400;

/**
 * Отпечаток пароля в ссылке сброса. Пароль сменился — отпечаток другой, и
 * ссылка больше не действует: одна ссылка — один сброс.
 */
export const passwordStamp = (hash: string | null): string => sha256(`pwd:${hash ?? ''}`).slice(0, 16);

/** Неверный пароль десять раз за 15 минут — пауза для этой почты. */
const passwordAttempts = new AttemptLimiter(10, 15 * 60_000);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
    private readonly twoFactor: TwoFactorService,
    private readonly mail: MailService,
    // Уведомления берутся по требованию: их модуль сам зависит от входа.
    private readonly moduleRef: ModuleRef,
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
        locale: ctx.lang ?? 'ru',
        profile: { create: { username: input.username, displayName: input.username } },
      },
      include: { profile: true },
    });

    if (user.email) {
      await this.sendVerification(user.id, user.email, user.profile!.username, ctx.lang ?? 'ru');
    }

    return this.issue(user.id, user.email, user.profile!.username, ctx);
  }

  private webUrl() {
    return process.env.WEB_URL ?? 'http://localhost:3000';
  }

  private async sendVerification(userId: string, email: string, username: string, lang: Lang) {
    const token = this.tokens.signPurpose(userId, 'email_verify', 3 * 24 * 3600);
    const link = `${this.webUrl()}/verify-email?token=${encodeURIComponent(token)}`;
    await this.mail.send(
      email,
      say(lang, 'Подтвердите e-mail — GameMarket'),
      say(lang, 'Здравствуйте, {name}. Подтвердите e-mail: {link}\nПокупки защищены эскроу.', { name: username, link }),
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

  /**
   * Запрос сброса пароля. Всегда «успех» — без утечки существования e-mail.
   * Письмо — на языке сайта, с которого просят сброс: человек сейчас там.
   */
  async requestPasswordReset(email: string, lang: Lang = 'ru'): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { profile: true } });
    if (user?.email) {
      const token = this.tokens.signPurpose(user.id, 'pwd_reset', 3600, passwordStamp(user.passwordHash));
      const link = `${this.webUrl()}/reset?token=${encodeURIComponent(token)}`;
      await this.mail.send(
        user.email,
        say(lang, 'Восстановление пароля — GameMarket'),
        say(lang, 'Сброс пароля (ссылка действует 1 час): {link}\nЕсли вы не запрашивали — проигнорируйте письмо.', {
          link,
        }),
      );
    }
  }

  /**
   * Новый пароль по ссылке из письма — «Забыли пароль» или «Это не я» после
   * смены пароля. Ссылка одноразовая: в ней отпечаток пароля, с которым её
   * выдали. Все устройства выходят, о смене приходит уведомление.
   */
  async resetPassword(token: string, password: string, ctx: RequestCtx = {}): Promise<void> {
    let claim: { sub: string; bind?: string };
    try {
      claim = this.tokens.verifyBound(token, 'pwd_reset');
    } catch {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }
    const userId = claim.sub;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user || claim.bind !== passwordStamp(user.passwordHash)) {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    // Условно: два запроса с одной ссылкой разом — пароль сменит только один.
    const done = await this.prisma.user.updateMany({
      where: { id: userId, passwordHash: user.passwordHash },
      data: { passwordHash },
    });
    if (!done.count) throw new BadRequestException('Ссылка недействительна или истекла');
    await this.prisma.authSession.deleteMany({ where: { userId } });
    this.alertPasswordChanged(userId, passwordHash, ctx);
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

  /**
   * Вход, когда личность уже подтвердил сервис (Telegram, VK, Google): те же
   * блокировка и код из приложения, что у входа по паролю, — иначе кнопка
   * «Войти через Google» обходила бы двухфакторную защиту.
   */
  async loginVerified(userId: string, code: string | undefined, ctx: RequestCtx): Promise<IssuedAuth> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!user?.profile) throw new UnauthorizedException('Пользователь не найден');
    if (user.status === 'banned') throw new ForbiddenException(BANNED);
    const second = await this.twoFactor.check(user.id, code);
    if (second !== 'ok') throw TwoFactorService.loginError(second);
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
    // Новый вход запоминает язык сайта: на нём придут письма, Telegram и пуши.
    // Обновление токена язык не трогает — фоновый запрос шлёт язык браузера.
    if (!familyId && ctx.lang) {
      await this.prisma.user.updateMany({ where: { id: userId, locale: { not: ctx.lang } }, data: { locale: ctx.lang } });
    }
    const accessToken = this.tokens.signAccess({ sub: userId, username, fam: family });
    const refreshToken = this.tokens.signRefresh({ sub: userId, sid });
    const ttl = Number(process.env.JWT_REFRESH_TTL ?? 2592000);
    // Новый вход сверяется с прежними до записи своего сеанса.
    const fresh = !familyId && (await this.isNewDevice(userId, ctx));

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
    // Письмо и уведомление — не задерживая вход: сбой почты вход не ломает.
    if (fresh) {
      void this.alertNewLogin(userId, family, ctx).catch((e: Error) =>
        this.logger.warn(`Вход с нового устройства ${userId}: ${e.message}`),
      );
    }

    const roles = await this.rolesOf(userId);
    return { user: { id: userId, email, username, roles }, accessToken, refreshToken };
  }

  /**
   * Вход с устройства, с которого человек не входил KNOWN_DEVICE_DAYS дней:
   * ни отпечатка устройства, ни той же строки браузера в его сеансах. Самый
   * первый вход — регистрация — не новость. Сеанс, о котором сказали «Это не
   * я», знакомым устройство не делает.
   */
  private async isNewDevice(userId: string, ctx: RequestCtx): Promise<boolean> {
    const since = new Date(Date.now() - KNOWN_DEVICE_DAYS * 86_400_000);
    const same = [
      ...(ctx.fingerprint ? [{ fingerprint: ctx.fingerprint }] : []),
      ...(ctx.userAgent ? [{ userAgent: ctx.userAgent }] : []),
    ];
    const [ever, known] = await Promise.all([
      this.prisma.authSession.count({ where: { userId }, take: 1 }),
      same.length
        ? this.prisma.authSession.count({
            where: { userId, createdAt: { gte: since }, deniedAt: null, OR: same },
            take: 1,
          })
        : Promise.resolve(0),
    ]);
    return ever > 0 && known === 0;
  }

  /**
   * «Вход с нового устройства»: на сайте, в Telegram и пушем — по настройкам,
   * письмом — всегда. Ссылка ведёт к этому сеансу в «Безопасности»: «Это не я»
   * завершает именно его.
   */
  private async alertNewLogin(userId: string, session: string, ctx: RequestCtx) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
    const lang = langOf(user?.locale);
    const device = deviceOf(ctx.userAgent, lang);
    const ip = ctx.ip ?? '—';
    await this.moduleRef.get(NotificationsService, { strict: false }).notify(userId, 'new_login', {
      session,
      device,
      ip,
      preview: say(
        lang,
        'Вход с нового устройства: {device}, IP {ip}. Если это были не вы — завершите сеанс в «Безопасности» и смените пароль.',
        { device, ip },
      ),
    });
  }

  // ── Пароль и сеансы из кабинета ──

  /**
   * Смена пароля: нужен текущий. Остальные устройства выходят сразу —
   * смену пароля делают, когда подозревают чужой вход. Аккаунт, заведённый
   * через Telegram, VK или Google, пароля не имеет — его задают без текущего.
   */
  async changePassword(
    userId: string,
    current: string | undefined,
    next: string,
    keepFamily?: string,
    ctx: RequestCtx = {},
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');
    if (user.passwordHash) {
      if (!current || !(await bcrypt.compare(current, user.passwordHash))) {
        throw new BadRequestException('Текущий пароль неверный');
      }
      if (current === next) throw new BadRequestException('Новый пароль совпадает с текущим');
    }
    const passwordHash = await bcrypt.hash(next, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    const closed = await this.closeSessions(userId, keepFamily);
    this.alertPasswordChanged(userId, passwordHash, ctx);
    return { ok: true, closedSessions: closed };
  }

  /**
   * «Пароль изменён»: на сайте, в Telegram и пушем — по настройкам, письмом —
   * всегда, с устройством и IP. В письме — «Это не я»: ссылка задать новый
   * пароль, сутки и один раз. Она есть только в письме: уведомления на сайте
   * видит тот, кто сейчас в аккаунте, — возможно, не владелец.
   */
  private alertPasswordChanged(userId: string, passwordHash: string, ctx: RequestCtx) {
    const send = async () => {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
      const lang = langOf(user?.locale);
      const device = deviceOf(ctx.userAgent, lang);
      const ip = ctx.ip ?? '—';
      const token = this.tokens.signPurpose(userId, 'pwd_reset', NOT_ME_RESET_TTL, passwordStamp(passwordHash));
      await this.moduleRef.get(NotificationsService, { strict: false }).notify(
        userId,
        'password_changed',
        {
          device,
          ip,
          preview: say(
            lang,
            'Пароль изменён: {device}, IP {ip}. Другие устройства вышли из аккаунта. Если это были не вы — восстановите доступ по ссылке «Это не я» из письма.',
            { device, ip },
          ),
        },
        {
          mail: {
            action: 'Это не я — восстановить доступ',
            link: `${this.webUrl()}/reset?token=${encodeURIComponent(token)}&not_me=1`,
          },
        },
      );
    };
    // Не задерживая ответ: сбой почты смену пароля не отменяет.
    void send().catch((e: Error) => this.logger.warn(`Пароль изменён ${userId}: ${e.message}`));
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

  /**
   * «Это не я» после входа с нового устройства: завершаются все сеансы этого
   * устройства (тот же отпечаток или та же строка браузера с того же адреса —
   * чужой мог войти и не раз), и оно перестаёт быть знакомым: следующий вход
   * с него снова даст предупреждение. Текущий сеанс не трогается.
   */
  async denySession(userId: string, familyId: string, currentFamily?: string) {
    if (familyId === currentFamily) {
      throw new BadRequestException('Это текущий сеанс — чтобы выйти на этом устройстве, нажмите «Выйти»');
    }
    if (!UUID_RE.test(familyId)) throw new NotFoundException('Сеанс не найден');
    const seen = await this.prisma.authSession.findFirst({
      where: { userId, familyId },
      orderBy: { createdAt: 'desc' },
      select: { userAgent: true, ip: true, fingerprint: true },
    });
    if (!seen) throw new NotFoundException('Сеанс не найден');
    const device = seen.fingerprint
      ? [{ fingerprint: seen.fingerprint }]
      : seen.userAgent
        ? [{ userAgent: seen.userAgent, ip: seen.ip }]
        : [];
    const where = {
      userId,
      ...(currentFamily ? { familyId: { not: currentFamily } } : {}),
      OR: [{ familyId }, ...device],
    };
    const now = new Date();
    const [closed] = await this.prisma.$transaction([
      this.prisma.authSession.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.authSession.updateMany({ where: { ...where, deniedAt: null }, data: { deniedAt: now } }),
    ]);
    return { ok: true, closedSessions: closed.count };
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
