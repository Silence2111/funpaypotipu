import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaClient } from '@gamemarket/db';
import {
  maskPhone,
  normalizeRuPhone,
  PD_CONSENT_REQUIRED,
  PD_CONSENT_VERSION,
  PHONE_CODE_ATTEMPTS,
  PHONE_CODE_LENGTH,
  PHONE_CODE_TTL_SEC,
  PHONE_CODES_PER_DAY,
  PHONE_CODES_PER_HOUR,
  PHONE_INVALID,
  PHONE_RESEND_SEC,
  phoneCodeText,
  suggestUsername,
  usernameSchema,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { SmsService } from '../sms/sms.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TokenService } from './token.service';
import { AuthService, type IssuedAuth, type RequestCtx } from './auth.service';
import { OAUTH_PROVIDERS } from './social/providers';

/** Пауза между кодами на номер; в e2e — секунда (`PHONE_RESEND_MS`). */
const RESEND_MS = Number(process.env.PHONE_RESEND_MS ?? PHONE_RESEND_SEC * 1000);
/** Билет после верного кода: на ник, согласие и код из приложения — 10 минут. */
const TICKET_TTL_SEC = 10 * 60;
const HOUR_MS = 3600_000;

type Purpose = 'login' | 'link';

const err = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  new HttpException({ statusCode: status, message, error, ...extra }, status);

/**
 * Вход и регистрация по российскому номеру телефона (часть 121, ч. 10 ст. 8
 * 149-ФЗ) и привязка номера в кабинете. Код из SMS — 6 цифр, 5 минут, 5
 * попыток; на номер — один код в минуту, 5 в час, 10 в сутки (SMS стоят
 * денег, а номер может быть чужим); на адрес — лимит запросов у маршрута.
 * В базе — только хеш кода.
 *
 * Верный код даёт билет на 10 минут: с ним вход завершается так же, как
 * через Яндекс ID — код из приложения, если включён, ник и согласие у
 * нового аккаунта, «Восстановить» у удалённого. Номер — и способ вернуть
 * доступ: забыл пароль — вошёл по номеру и задал новый.
 */
@Injectable()
export class PhoneService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly sms: SmsService,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
  ) {}

  config() {
    return { enabled: this.sms.enabled, codeLength: PHONE_CODE_LENGTH, resendSec: Math.round(RESEND_MS / 1000) };
  }

  private hash(phone: string, code: string): string {
    const secret = process.env.JWT_ACCESS_SECRET ?? 'dev-phone-secret';
    return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
  }

  /** Отправить код: вход (purpose login) или привязка (link, userId — кто привязывает). */
  async start(raw: string, purpose: Purpose, ctx: RequestCtx, userId?: string) {
    if (!this.sms.enabled) throw new ServiceUnavailableException('Вход по телефону пока не работает');
    const phone = normalizeRuPhone(raw);
    if (!phone) throw new BadRequestException(PHONE_INVALID);
    if (purpose === 'link') await this.assertFree(phone, userId!);

    const now = Date.now();
    const last = await this.prisma.phoneCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (last && now - last.createdAt.getTime() < RESEND_MS) {
      const retryIn = Math.ceil((RESEND_MS - (now - last.createdAt.getTime())) / 1000);
      throw err(429, 'phone_code_wait', `Новый код — через ${retryIn} сек.`, { retryIn });
    }
    const [hour, day] = await Promise.all([
      this.prisma.phoneCode.count({ where: { phone, createdAt: { gte: new Date(now - HOUR_MS) } } }),
      this.prisma.phoneCode.count({ where: { phone, createdAt: { gte: new Date(now - 24 * HOUR_MS) } } }),
    ]);
    if (hour >= PHONE_CODES_PER_HOUR || day >= PHONE_CODES_PER_DAY) {
      throw err(429, 'phone_code_limit', 'Слишком много кодов на этот номер — попробуйте позже');
    }

    const code = String(randomInt(0, 10 ** PHONE_CODE_LENGTH)).padStart(PHONE_CODE_LENGTH, '0');
    await this.prisma.phoneCode.create({
      data: {
        phone,
        purpose,
        userId: userId ?? null,
        codeHash: this.hash(phone, code),
        expiresAt: new Date(now + PHONE_CODE_TTL_SEC * 1000),
        ip: ctx.ip?.slice(0, 64) ?? null,
      },
    });
    await this.sms.send(phone, phoneCodeText(code));
    return { sentTo: maskPhone(phone), retryIn: Math.round(RESEND_MS / 1000), ttl: PHONE_CODE_TTL_SEC };
  }

  /** Проверить код: верный — погашен; неверный — минус попытка; пять — только новый код. */
  private async check(raw: string, code: string, purpose: Purpose, userId?: string): Promise<string> {
    const phone = normalizeRuPhone(raw);
    if (!phone) throw new BadRequestException(PHONE_INVALID);
    const row = await this.prisma.phoneCode.findFirst({
      where: { phone, purpose, usedAt: null, expiresAt: { gt: new Date() }, ...(userId ? { userId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw err(400, 'phone_code_expired', 'Код устарел — запросите новый');
    if (row.attempts >= PHONE_CODE_ATTEMPTS) {
      throw err(429, 'phone_code_locked', 'Слишком много неверных кодов — запросите новый');
    }
    const given = Buffer.from(this.hash(phone, code.trim()));
    const stored = Buffer.from(row.codeHash);
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
      const attempts = row.attempts + 1;
      await this.prisma.phoneCode.update({ where: { id: row.id }, data: { attempts } });
      if (attempts >= PHONE_CODE_ATTEMPTS) {
        throw err(429, 'phone_code_locked', 'Слишком много неверных кодов — запросите новый');
      }
      throw err(400, 'phone_code_invalid', 'Код не подошёл', { left: PHONE_CODE_ATTEMPTS - attempts });
    }
    // Погашение — условное: два одновременных ввода одного кода не дают два входа.
    const used = await this.prisma.phoneCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) throw err(400, 'phone_code_expired', 'Код устарел — запросите новый');
    return phone;
  }

  /** Код для входа верный — билет на завершение входа или регистрации. */
  async verify(raw: string, code: string) {
    const phone = await this.check(raw, code, 'login');
    const known = await this.prisma.user.findFirst({
      where: { phone, phoneVerifiedAt: { not: null }, erasedAt: null },
      select: { id: true },
    });
    return { ticket: this.tokens.signData({ phone }, 'phone_ticket', TICKET_TTL_SEC), registered: !!known };
  }

  /**
   * Завершить вход по билету. Номер привязан — вход (код из приложения и
   * «Восстановить» — как у пароля). Не привязан — новый аккаунт: ник и
   * согласие на обработку ПД (часть 120).
   */
  async complete(
    ticket: string,
    input: { code?: string; restore?: boolean; username?: string; pdConsent?: boolean },
    ctx: RequestCtx,
  ): Promise<IssuedAuth> {
    let phone: string;
    try {
      phone = this.tokens.verifyData<{ phone: string }>(ticket, 'phone_ticket').phone;
    } catch {
      throw err(401, 'phone_expired', 'Вход по номеру устарел — запросите код заново');
    }
    const user = await this.prisma.user.findFirst({
      where: { phone, phoneVerifiedAt: { not: null }, erasedAt: null },
      select: { id: true },
    });
    if (user) return this.auth.loginVerified(user.id, input.code?.trim(), ctx, input.restore);

    const username = input.username?.trim().toLowerCase();
    if (!username) {
      throw err(400, 'username_required', 'Выберите ник — по нему вас найдут покупатели и продавцы', {
        suggested: await this.freeUsername(suggestUsername(`player_${phone.slice(-4)}`)),
      });
    }
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) throw new BadRequestException(`Ник: ${parsed.error.issues[0]?.message ?? 'не подходит'}`);
    if (await this.prisma.profile.findUnique({ where: { username }, select: { userId: true } })) {
      throw err(409, 'username_taken', 'Этот ник занят', { suggested: await this.freeUsername(username) });
    }
    if (!input.pdConsent) throw err(400, 'consent_required', PD_CONSENT_REQUIRED);
    // Номер мог остаться неподтверждённым у другого аккаунта — подтверждённый важнее.
    await this.prisma.user.updateMany({ where: { phone, phoneVerifiedAt: null }, data: { phone: null } });
    const created = await this.prisma.user.create({
      data: {
        phone,
        phoneVerifiedAt: new Date(),
        profile: { create: { username, displayName: username } },
        consents: {
          create: {
            version: PD_CONSENT_VERSION,
            method: 'phone',
            ip: ctx.ip?.slice(0, 64) ?? null,
            userAgent: ctx.userAgent?.slice(0, 300) ?? null,
          },
        },
      },
      select: { id: true },
    });
    return this.auth.loginVerified(created.id, undefined, ctx);
  }

  private async freeUsername(base: string): Promise<string> {
    const stem = base.replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'player';
    for (let i = 0; i < 20; i++) {
      const name = i === 0 ? stem : `${stem}${randomInt(10, 9999)}`;
      if (name.length >= 3 && !(await this.prisma.profile.findUnique({ where: { username: name }, select: { userId: true } }))) {
        return name;
      }
    }
    return `player${randomInt(10000, 99999)}`;
  }

  private async assertFree(phone: string, userId: string) {
    const other = await this.prisma.user.findFirst({
      where: { phone, phoneVerifiedAt: { not: null }, NOT: { id: userId } },
      select: { id: true },
    });
    if (other) throw new ConflictException('Этот номер уже привязан к другому аккаунту');
  }

  /** Номер в «Безопасности»: целиком — владельцу. */
  async status(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, phoneVerifiedAt: true } });
    if (!u) throw new NotFoundException('Пользователь не найден');
    return { phone: u.phone && u.phoneVerifiedAt ? u.phone : null, enabled: this.sms.enabled };
  }

  /** Привязать номер: код пришёл на него — номер свой. Старый номер заменяется. */
  async link(userId: string, raw: string, code: string) {
    const phone = await this.check(raw, code, 'link', userId);
    await this.assertFree(phone, userId);
    await this.prisma.user.updateMany({ where: { phone, phoneVerifiedAt: null, NOT: { id: userId } }, data: { phone: null } });
    await this.prisma.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: new Date() } });
    // Предупреждение владельцу — как о смене почты: привязал не он — увидит сразу.
    await this.notifications.notify(userId, 'phone_changed', { preview: maskPhone(phone) }).catch(() => undefined);
    return this.status(userId);
  }

  /** Отвязать номер — если есть другой способ входа. */
  async unlink(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, passwordHash: true, email: true, socialAccounts: { select: { provider: true } } },
    });
    if (!u) throw new NotFoundException('Пользователь не найден');
    if (!u.phone) return this.status(userId);
    const other =
      !!(u.passwordHash && u.email) ||
      u.socialAccounts.some((a) => (OAUTH_PROVIDERS as readonly string[]).includes(a.provider));
    if (!other) throw new BadRequestException('Это единственный способ входа — сначала задайте почту и пароль');
    await this.prisma.user.update({ where: { id: userId }, data: { phone: null, phoneVerifiedAt: null } });
    await this.notifications.notify(userId, 'phone_changed', { preview: `− ${maskPhone(u.phone)}` }).catch(() => undefined);
    return this.status(userId);
  }

  /** Последнее SMS на номер — только для e2e (`SMS_TEST_INBOX=1`, заглушка, не прод). */
  testInbox(raw: string): { text: string | null } {
    if (!this.sms.testInbox) throw new NotFoundException();
    const phone = normalizeRuPhone(raw);
    return { text: phone ? this.sms.lastText(phone) : null };
  }
}
