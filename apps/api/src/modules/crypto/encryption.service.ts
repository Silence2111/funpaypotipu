import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Шифрование чувствительных данных в покое (ключи товаров, реквизиты выплат) —
 * AES-256-GCM. Ключ деривится из DATA_ENCRYPTION_KEY (docs/09). В проде — KMS/Vault.
 */
@Injectable()
export class EncryptionService {
  private readonly key = createHash('sha256')
    .update(process.env.DATA_ENCRYPTION_KEY ?? 'dev-insecure-key')
    .digest();

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, enc].map((b) => b.toString('base64')).join(':');
  }

  decrypt(payload: string): string {
    const [ivB, tagB, encB] = payload.split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encB, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
