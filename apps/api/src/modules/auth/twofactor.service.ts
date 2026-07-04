import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { EncryptionService } from '../crypto/encryption.service';

/** Двухфакторная аутентификация (TOTP), секрет хранится зашифрованным (docs/09). */
@Injectable()
export class TwoFactorService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly encryption: EncryptionService,
  ) {}

  /** Сгенерировать секрет (ещё не активна). Возвращает otpauth-URL для QR. */
  async setup(userId: string, username: string) {
    const secret = authenticator.generateSecret();
    await this.prisma.twoFactor.upsert({
      where: { userId },
      update: { secretEnc: this.encryption.encrypt(secret), enabledAt: null },
      create: { userId, secretEnc: this.encryption.encrypt(secret) },
    });
    return { otpauth: authenticator.keyuri(username, 'GameMarket', secret), secret };
  }

  async enable(userId: string, code: string) {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf) throw new BadRequestException('Сначала вызовите /auth/2fa/setup');
    if (!authenticator.verify({ token: code, secret: this.encryption.decrypt(tf.secretEnc) })) {
      throw new BadRequestException('Неверный код');
    }
    await this.prisma.twoFactor.update({ where: { userId }, data: { enabledAt: new Date() } });
    return { ok: true };
  }

  async disable(userId: string, code: string) {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf?.enabledAt) return { ok: true };
    if (!authenticator.verify({ token: code, secret: this.encryption.decrypt(tf.secretEnc) })) {
      throw new BadRequestException('Неверный код');
    }
    await this.prisma.twoFactor.delete({ where: { userId } });
    return { ok: true };
  }

  async isEnabled(userId: string): Promise<boolean> {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    return !!tf?.enabledAt;
  }

  /** Проверка кода при логине. true, если 2FA не включена. */
  async verify(userId: string, code?: string): Promise<boolean> {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf?.enabledAt) return true;
    if (!code) return false;
    return authenticator.verify({ token: code, secret: this.encryption.decrypt(tf.secretEnc) });
  }
}
