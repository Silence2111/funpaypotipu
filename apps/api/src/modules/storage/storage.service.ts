import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import * as Minio from 'minio';

/** Ключ объекта: префикс и путь без «..» — его же видно в адресе файла. */
export const SAFE_KEY = /^[a-z]+\/[\w./-]+$/;
const ASSET_BASE = process.env.PUBLIC_ASSET_BASE ?? '';

/**
 * Хранилище вложений чата, фото лотов, аватаров, доказательств в спорах и
 * документов проверки.
 *
 * S3-совместимое (MinIO локально, S3 в проде), если задан S3_ENDPOINT. Без
 * него — папка на диске сервера (STORAGE_DIR, по умолчанию .data/uploads):
 * раньше без S3 хранилище выключалось целиком, и на стенде не работали ни
 * фото лотов, ни вложения в чате. У диска те же подписанные ссылки, что у
 * S3, — через /api/assets/upload и /api/assets/file, — так что клиенты не
 * знают, где лежит файл. STORAGE_DIR=off выключает хранилище, как раньше.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: Minio.Client | null = null;
  private readonly bucket = process.env.S3_BUCKET ?? 'gamemarket';
  private dir: string | null = null;
  // Ключ подписи ссылок диска; без настроек — случайный на время работы процесса.
  private readonly signingKey =
    process.env.STORAGE_SIGNING_SECRET ??
    process.env.DATA_ENCRYPTION_KEY ??
    randomBytes(32).toString('hex');

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    if (endpoint) {
      const url = new URL(endpoint);
      this.client = new Minio.Client({
        endPoint: url.hostname,
        port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
        useSSL: url.protocol === 'https:',
        accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
        secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
      });
      return;
    }
    const dir = process.env.STORAGE_DIR ?? '.data/uploads';
    if (dir !== 'off') this.dir = resolve(dir);
  }

  get enabled(): boolean {
    return this.client !== null || this.dir !== null;
  }

  async onModuleInit() {
    if (this.dir) {
      try {
        await mkdir(this.dir, { recursive: true });
        this.logger.log(`Хранилище на диске: ${this.dir}`);
      } catch (e) {
        this.dir = null;
        this.logger.warn(`Папка хранилища недоступна: ${(e as Error).message}`);
      }
      return;
    }
    if (!this.client) return;
    try {
      if (!(await this.client.bucketExists(this.bucket))) {
        await this.client.makeBucket(this.bucket);
      }
      this.logger.log(`Хранилище готово, бакет: ${this.bucket}`);
    } catch (e) {
      this.client = null;
      this.logger.warn(`Хранилище недоступно: ${(e as Error).message}`);
    }
  }

  /** Presigned PUT-URL для прямой загрузки клиентом. */
  presignPut(key: string, expirySec = 300): Promise<string> {
    if (this.dir) return Promise.resolve(this.localUrl('upload', key, expirySec));
    if (!this.client) throw new Error('storage disabled');
    return this.client.presignedPutObject(this.bucket, key, expirySec);
  }

  /** Presigned GET-URL для чтения (вложения приватны). */
  presignGet(key: string, expirySec = 3600): Promise<string> {
    if (this.dir) return Promise.resolve(this.localUrl('file', key, expirySec));
    if (!this.client) throw new Error('storage disabled');
    return this.client.presignedGetObject(this.bucket, key, expirySec);
  }

  /** Прямая загрузка объекта через API (MinIO остаётся приватным). */
  async put(key: string, buffer: Buffer, contentType: string): Promise<void> {
    if (this.dir) {
      const path = this.pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buffer);
      return;
    }
    if (!this.client) throw new Error('storage disabled');
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': contentType,
    });
  }

  /** Скачать объект в память (для антивирус-скана). */
  async getBytes(key: string): Promise<Buffer> {
    if (this.dir) return readFile(this.pathOf(key));
    if (!this.client) throw new Error('storage disabled');
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  async remove(key: string): Promise<void> {
    if (this.dir) {
      await rm(this.pathOf(key), { force: true }).catch(() => undefined);
      return;
    }
    if (this.client) await this.client.removeObject(this.bucket, key).catch(() => undefined);
  }

  /**
   * Проверка подписанной ссылки диска: операция, ключ и срок подписаны
   * ключом сервера — чужой ключ или продлённый срок не пройдут.
   */
  verifyLocal(op: 'upload' | 'file', key: string, exp: string, sig: string): boolean {
    if (!this.dir || !SAFE_KEY.test(key) || key.includes('..')) return false;
    if (!/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) return false;
    const want = Buffer.from(this.sign(op, key, exp));
    const got = Buffer.from(sig ?? '');
    return want.length === got.length && timingSafeEqual(want, got);
  }

  private localUrl(op: 'upload' | 'file', key: string, expirySec: number): string {
    const exp = String(Math.floor(Date.now() / 1000) + expirySec);
    const q = new URLSearchParams({ key, exp, sig: this.sign(op, key, exp) });
    return `${ASSET_BASE}/api/assets/${op}?${q}`;
  }

  private sign(op: string, key: string, exp: string): string {
    return createHmac('sha256', this.signingKey)
      .update(`${op}\n${key}\n${exp}`)
      .digest('base64url');
  }

  /** Путь файла внутри папки хранилища; ключ с выходом за её пределы — ошибка. */
  private pathOf(key: string): string {
    if (!this.dir || !SAFE_KEY.test(key) || key.includes('..')) throw new Error('bad storage key');
    const path = resolve(this.dir, key);
    if (!path.startsWith(this.dir + sep)) throw new Error('bad storage key');
    return path;
  }
}
