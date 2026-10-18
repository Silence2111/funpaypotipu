import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { EncryptionService } from '../crypto/encryption.service';
import { AttemptLimiter } from './attempts';

const RECOVERY_COUNT = 8;
// Без похожих символов: 0/o, 1/l/i — код переписывают с бумаги.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** «ABCDE FGHJK», «abcde-fghjk» → «abcdefghjk»: резервный код вводят как угодно. */
export const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecovery = (code: string) => createHash('sha256').update(normalizeRecovery(code)).digest('hex');

export function newRecoveryCodes(n = RECOVERY_COUNT): string[] {
  return Array.from({ length: n }, () => {
    const raw = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Итог проверки кода при входе. */
export type TwoFactorCheck = 'ok' | 'required' | 'invalid' | 'locked';

/**
 * Двухфакторная аутентификация (TOTP), секрет хранится зашифрованным
 * (docs/09). Резервные коды — на случай потерянного телефона: каждый
 * работает один раз, хранятся хешами. Неверный код пять раз за 15 минут —
 * пауза: шесть цифр иначе перебираются за часы.
 */
@Injectable()
export class TwoFactorService {
  private readonly attempts = new AttemptLimiter(5, 15 * 60_000);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly encryption: EncryptionService,
  ) {}

  /** Сгенерировать секрет (ещё не активна): ключ для ручного ввода и QR-код для приложения. */
  async setup(userId: string, username: string) {
    const secret = authenticator.generateSecret();
    await this.prisma.twoFactor.upsert({
      where: { userId },
      update: { secretEnc: this.encryption.encrypt(secret), enabledAt: null, recoveryCodesEnc: null },
      create: { userId, secretEnc: this.encryption.encrypt(secret) },
    });
    const otpauth = authenticator.keyuri(username, 'GameMarket', secret);
    const qrSvg = await QRCode.toString(otpauth, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    return { otpauth, secret, qrSvg };
  }

  /** Включить: код из приложения подтверждает, что ключ добавлен. Резервные коды показываются один раз. */
  async enable(userId: string, code: string) {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf) throw new BadRequestException('Сначала вызовите /auth/2fa/setup');
    if (!authenticator.verify({ token: code, secret: this.encryption.decrypt(tf.secretEnc) })) {
      throw new BadRequestException('Неверный код');
    }
    const recoveryCodes = newRecoveryCodes();
    await this.prisma.twoFactor.update({
      where: { userId },
      data: { enabledAt: new Date(), recoveryCodesEnc: this.sealCodes(recoveryCodes.map(hashRecovery)) },
    });
    return { ok: true, recoveryCodes };
  }

  /** Отключить — кодом из приложения или резервным. */
  async disable(userId: string, code: string) {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf?.enabledAt) return { ok: true };
    if ((await this.check(userId, code)) !== 'ok') throw new BadRequestException('Неверный код');
    await this.prisma.twoFactor.delete({ where: { userId } });
    return { ok: true };
  }

  /** Новые резервные коды взамен старых — по коду из приложения. */
  async regenerate(userId: string, code: string) {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf?.enabledAt) throw new BadRequestException('Двухфакторная защита не включена');
    if (!authenticator.verify({ token: code, secret: this.encryption.decrypt(tf.secretEnc) })) {
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
    return { enabled: !!tf?.enabledAt, recoveryLeft: tf?.enabledAt ? this.openCodes(tf.recoveryCodesEnc).length : 0 };
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
    if (/^\d{6}$/.test(totp) && authenticator.verify({ token: totp, secret: this.encryption.decrypt(tf.secretEnc) })) {
      this.attempts.reset(userId);
      return 'ok';
    }
    const hashes = this.openCodes(tf.recoveryCodesEnc);
    const hit = hashes.indexOf(hashRecovery(code));
    if (hit >= 0) {
      hashes.splice(hit, 1);
      await this.prisma.twoFactor.update({ where: { userId }, data: { recoveryCodesEnc: this.sealCodes(hashes) } });
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
    return new HttpException({ statusCode: status, message, error: `two_factor_${result}` }, status);
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
