import { BadRequestException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash, randomInt } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaClient } from '@gamemarket/db';
import { deviceOf } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { EncryptionService } from '../crypto/encryption.service';
import { NotificationsService } from '../notifications/notifications.service';
import { langOf, say } from '../../i18n/texts';
import { AttemptLimiter } from './attempts';
import { TokenService } from './token.service';
import type { RequestCtx } from './auth.service';

/**
 * Код из приложения проверяется с соседними 30-секундными окнами. Иначе
 * верный код, набранный в последнюю секунду окна или с отстающими часами
 * телефона, отклонялся: пока запрос доходит, окно сменилось (так однажды
 * упал и e2e). Одно окно в обе стороны — допуск, который советует RFC 6238.
 */
const otp = authenticator.clone({ window: 1 });

const RECOVERY_COUNT = 8;
// Без похожих символов: 0/o, 1/l/i — код переписывают с бумаги.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** «ABCDE FGHJK», «abcde-fghjk» → «abcdefghjk»: резервный код вводят как угодно. */
export const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecovery = (code: string) =>
  createHash('sha256').update(normalizeRecovery(code)).digest('hex');

export function newRecoveryCodes(n = RECOVERY_COUNT): string[] {
  return Array.from({ length: n }, () => {
    const raw = Array.from(
      { length: 10 },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
    ).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Итог проверки кода при входе. */
export type TwoFactorCheck = 'ok' | 'required' | 'invalid' | 'locked';

/** Ссылка «Это не я» из письма о включении входа с кодом живёт неделю. */
export const TF_REVOKE_TTL = 7 * 86_400;

/** Отпечаток включённого входа с кодом: выключили или сменили ключ — ссылка гаснет. */
const tfStamp = (secretEnc: string) =>
  createHash('sha256').update(`tf:${secretEnc}`).digest('hex').slice(0, 16);

/**
 * Двухфакторная аутентификация (TOTP), секрет хранится зашифрованным
 * (docs/09). Резервные коды — на случай потерянного телефона: каждый
 * работает один раз, хранятся хешами. Неверный код пять раз за 15 минут —
 * пауза: шесть цифр иначе перебираются за часы.
 */
@Injectable()
export class TwoFactorService {
  private readonly attempts = new AttemptLimiter(5, 15 * 60_000);
  /** Пароль в «Это не я» перебирать так же нельзя, как код. */
  private readonly revokeAttempts = new AttemptLimiter(5, 15 * 60_000);
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly encryption: EncryptionService,
    private readonly tokens: TokenService,
    // Уведомления берутся по требованию: их модуль сам зависит от входа.
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Сгенерировать секрет (ещё не активна): ключ для ручного ввода и QR-код для приложения. */
  async setup(userId: string, username: string) {
    const secret = authenticator.generateSecret();
    await this.prisma.twoFactor.upsert({
      where: { userId },
      update: {
        secretEnc: this.encryption.encrypt(secret),
        enabledAt: null,
        recoveryCodesEnc: null,
      },
      create: { userId, secretEnc: this.encryption.encrypt(secret) },
    });
    const otpauth = authenticator.keyuri(username, 'GameMarket', secret);
    const qrSvg = await QRCode.toString(otpauth, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
    });
    return { otpauth, secret, qrSvg };
  }

  /**
   * Включить: код из приложения подтверждает, что ключ добавлен. Резервные
   * коды показываются один раз. Запоминается хеш пароля на этот момент — для
   * «Это не я», — и владельцу уходит уведомление, письмом всегда.
   */
  async enable(userId: string, code: string, ctx: RequestCtx = {}) {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf) throw new BadRequestException('Сначала вызовите /auth/2fa/setup');
    if (!otp.verify({ token: code, secret: this.encryption.decrypt(tf.secretEnc) })) {
      throw new BadRequestException('Неверный код');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    const recoveryCodes = newRecoveryCodes();
    await this.prisma.twoFactor.update({
      where: { userId },
      data: {
        enabledAt: new Date(),
        recoveryCodesEnc: this.sealCodes(recoveryCodes.map(hashRecovery)),
        passwordHashAtEnable: user?.passwordHash ?? null,
      },
    });
    this.alert(userId, 'two_factor_enabled', ctx, tf.secretEnc);
    return { ok: true, recoveryCodes };
  }

  /** Отключить — кодом из приложения или резервным. */
  async disable(userId: string, code: string, ctx: RequestCtx = {}) {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf?.enabledAt) return { ok: true };
    if ((await this.check(userId, code)) !== 'ok') throw new BadRequestException('Неверный код');
    await this.prisma.twoFactor.delete({ where: { userId } });
    this.alert(userId, 'two_factor_disabled', ctx);
    return { ok: true };
  }

  /**
   * «Это не я» из письма о включении входа с кодом. Одна ссылка из почты
   * защиту не снимает — иначе её снял бы любой, кто читает почту и сбросил
   * через неё пароль. Нужен ещё пароль, который был у аккаунта, когда вход с
   * кодом включили: его знает владелец. Итог — вход с кодом выключен, пароль
   * новый, все устройства вышли из аккаунта.
   */
  async revokeByLink(token: string, password: string, next: string, ctx: RequestCtx = {}) {
    let claim: { sub: string; bind?: string };
    try {
      claim = this.tokens.verifyBound(token, 'tf_revoke');
    } catch {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }
    const userId = claim.sub;
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf?.enabledAt || claim.bind !== tfStamp(tf.secretEnc)) {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }
    const wait = this.revokeAttempts.wait(userId);
    if (wait) {
      throw new HttpException(
        {
          statusCode: 429,
          message: `Слишком много попыток. Попробуйте через ${wait} мин.`,
          error: 'too_many_attempts',
        },
        429,
      );
    }
    if (!tf.passwordHashAtEnable) {
      throw new BadRequestException(
        'Так выключить нельзя: когда включали вход с кодом, у аккаунта не было пароля',
      );
    }
    if (!(await bcrypt.compare(password, tf.passwordHashAtEnable))) {
      this.revokeAttempts.fail(userId);
      throw new BadRequestException(
        'Это не тот пароль, что был у аккаунта, когда включали вход с кодом',
      );
    }
    this.revokeAttempts.reset(userId);
    const passwordHash = await bcrypt.hash(next, 12);
    await this.prisma.$transaction(async (tx) => {
      // Условно: та же ссылка дважды разом выключит защиту один раз.
      const gone = await tx.twoFactor.deleteMany({
        where: { userId, secretEnc: tf.secretEnc, enabledAt: { not: null } },
      });
      if (!gone.count) throw new BadRequestException('Ссылка недействительна или истекла');
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.authSession.deleteMany({ where: { userId } });
    });
    this.alert(userId, 'two_factor_disabled', ctx);
    return { ok: true };
  }

  /**
   * «Вход с кодом включён / выключен»: на сайте, в Telegram и пушем — по
   * настройкам, письмом — всегда. У включения в письме — «Это не я» со
   * ссылкой на неделю; в данных уведомления её нет.
   */
  private alert(
    userId: string,
    type: 'two_factor_enabled' | 'two_factor_disabled',
    ctx: RequestCtx,
    secretEnc?: string,
  ) {
    const send = async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { locale: true },
      });
      const lang = langOf(user?.locale);
      const device = deviceOf(ctx.userAgent, lang);
      const ip = ctx.ip ?? '—';
      const preview =
        type === 'two_factor_enabled'
          ? say(
              lang,
              'Вход с кодом из приложения включён: {device}, IP {ip}. Если это были не вы — выключите его по ссылке «Это не я» из письма.',
              { device, ip },
            )
          : say(lang, 'Вход с кодом из приложения выключен: {device}, IP {ip}.', { device, ip });
      const web = process.env.WEB_URL ?? 'http://localhost:3000';
      const mail = secretEnc
        ? {
            action: 'Это не я — выключить вход с кодом',
            link: `${web}/recover-2fa?token=${encodeURIComponent(
              this.tokens.signPurpose(userId, 'tf_revoke', TF_REVOKE_TTL, tfStamp(secretEnc)),
            )}`,
          }
        : undefined;
      await this.moduleRef
        .get(NotificationsService, { strict: false })
        .notify(userId, type, { device, ip, preview }, mail ? { mail } : {});
    };
    // Не задерживая ответ: сбой почты защиту не отменяет.
    void send().catch((e: Error) => this.logger.warn(`Вход с кодом ${userId}: ${e.message}`));
  }

  /** Новые резервные коды взамен старых — по коду из приложения. */
  async regenerate(userId: string, code: string) {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf?.enabledAt) throw new BadRequestException('Двухфакторная защита не включена');
    if (!otp.verify({ token: code, secret: this.encryption.decrypt(tf.secretEnc) })) {
      throw new BadRequestException('Неверный код');
    }
    const recoveryCodes = newRecoveryCodes();
    await this.prisma.twoFactor.update({
      where: { userId },
      data: { recoveryCodesEnc: this.sealCodes(recoveryCodes.map(hashRecovery)) },
    });
    return { recoveryCodes };
  }

  async status(userId: string) {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    return {
      enabled: !!tf?.enabledAt,
      recoveryLeft: tf?.enabledAt ? this.openCodes(tf.recoveryCodesEnc).length : 0,
    };
  }

  async isEnabled(userId: string): Promise<boolean> {
    return (await this.status(userId)).enabled;
  }

  /**
   * Проверка при входе: код из приложения или резервный (он сгорает).
   * 'ok' — и когда защита не включена.
   */
  async check(userId: string, code?: string): Promise<TwoFactorCheck> {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf?.enabledAt) return 'ok';
    if (!code?.trim()) return 'required';
    if (this.attempts.wait(userId)) return 'locked';

    const totp = code.replace(/\s/g, '');
    if (
      /^\d{6}$/.test(totp) &&
      otp.verify({ token: totp, secret: this.encryption.decrypt(tf.secretEnc) })
    ) {
      this.attempts.reset(userId);
      return 'ok';
    }
    const hashes = this.openCodes(tf.recoveryCodesEnc);
    const hit = hashes.indexOf(hashRecovery(code));
    if (hit >= 0) {
      hashes.splice(hit, 1);
      await this.prisma.twoFactor.update({
        where: { userId },
        data: { recoveryCodesEnc: this.sealCodes(hashes) },
      });
      this.attempts.reset(userId);
      return 'ok';
    }
    this.attempts.fail(userId);
    return 'invalid';
  }

  /** Ошибка входа по итогу проверки: клиент различает «спросить код» и «код не подошёл». */
  static loginError(result: Exclude<TwoFactorCheck, 'ok'>): HttpException {
    const [status, message] =
      result === 'required'
        ? [401, 'Введите код из приложения-аутентификатора']
        : result === 'invalid'
          ? [401, 'Код не подошёл. Проверьте время на телефоне или введите резервный код']
          : [429, 'Слишком много неверных кодов. Попробуйте через 15 минут'];
    return new HttpException(
      { statusCode: status, message, error: `two_factor_${result}` },
      status,
    );
  }

  private sealCodes(hashes: string[]): string {
    return this.encryption.encrypt(JSON.stringify(hashes));
  }

  private openCodes(sealed: string | null): string[] {
    if (!sealed) return [];
    try {
      const v = JSON.parse(this.encryption.decrypt(sealed)) as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
}
