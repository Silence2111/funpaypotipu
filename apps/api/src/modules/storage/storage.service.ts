import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import * as Minio from 'minio';

/**
 * S3-совместимое хранилище (MinIO локально, S3 в проде) для вложений чата и картинок.
 * Если S3_ENDPOINT не задан или недоступен — хранилище выключено (enabled=false).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: Minio.Client | null = null;
  private readonly bucket = process.env.S3_BUCKET ?? 'gamemarket';

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    if (!endpoint) return;
    const url = new URL(endpoint);
    this.client = new Minio.Client({
      endPoint: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      useSSL: url.protocol === 'https:',
      accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
      secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    });
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async onModuleInit() {
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
    if (!this.client) throw new Error('storage disabled');
    return this.client.presignedPutObject(this.bucket, key, expirySec);
  }

  /** Presigned GET-URL для чтения (вложения приватны). */
  presignGet(key: string, expirySec = 3600): Promise<string> {
    if (!this.client) throw new Error('storage disabled');
    return this.client.presignedGetObject(this.bucket, key, expirySec);
  }
}
