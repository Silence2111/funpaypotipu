import {
  BadRequestException,
  ConflictException,
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

export interface RequestCtx {
  userAgent?: string;
  ip?: string;
  fingerprint?: string;
}

export interface IssuedAuth {
  user: { id: string; email: string | null; username: string };
  accessToken: string;
  refreshToken: string;
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

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
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { profile: true },
    });
    if (!user?.passwordHash || !user.profile) throw new UnauthorizedException('Неверные данные');

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Неверные данные');

    if (!(await this.twoFactor.verify(user.id, input.code))) {
      throw new UnauthorizedException('Требуется код двухфакторной аутентификации');
    }

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

    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: { profile: true },
    });
    if (!user?.profile) throw new UnauthorizedException('Пользователь не найден');

    return this.issue(user.id, user.email, user.profile.username, ctx);
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

  private async issue(
    userId: string,
    email: string | null,
    username: string,
    ctx: RequestCtx,
  ): Promise<IssuedAuth> {
    const sid = randomUUID();
    const accessToken = this.tokens.signAccess({ sub: userId, username });
    const refreshToken = this.tokens.signRefresh({ sub: userId, sid });
    const ttl = Number(process.env.JWT_REFRESH_TTL ?? 2592000);

    await this.prisma.authSession.create({
      data: {
        id: sid,
        userId,
        refreshTokenHash: sha256(refreshToken),
        userAgent: ctx.userAgent,
        ip: ctx.ip,
        fingerprint: ctx.fingerprint,
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });

    return { user: { id: userId, email, username }, accessToken, refreshToken };
  }
}
