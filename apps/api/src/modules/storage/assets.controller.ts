import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  PayloadTooLargeException,
  Put,
  Query,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { StorageService } from './storage.service';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  plain: 'text/plain; charset=utf-8',
  mp4: 'video/mp4',
  webm: 'video/webm',
  quicktime: 'video/quicktime',
};

/** Больше — не вложение, а повод перейти на S3. */
const MAX_UPLOAD = 15 * 1024 * 1024;

const mimeOf = (key: string) => MIME[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/**
 * Файл отдаётся с адреса API, где живёт cookie входа: загруженный HTML или
 * SVG со скриптом не должен выполниться. Песочница CSP и запрет угадывать
 * тип; что не картинка, не видео и не PDF — скачивается, а не открывается.
 */
function sendFile(res: Response, key: string, bytes: Buffer, cache: string) {
  const mime = mimeOf(key);
  const inline = /^(image\/(?!svg)|video\/|application\/pdf|text\/plain)/.test(mime);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', inline ? 'inline' : 'attachment');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'");
  res.setHeader('Cache-Control', cache);
  res.send(bytes);
}

@Controller('assets')
export class AssetsController {
  constructor(private readonly storage: StorageService) {}

  /**
   * Публичная отдача изображений лотов/игр (приватный MinIO наружу не открыт).
   * Разрешены только префиксы listings/, games/ и avatars/ — вложения чата и KYC остаются приватными.
   */
  @Get()
  async serve(@Query('key') key: string, @Res() res: Response) {
    if (!key || !/^(listings|games|avatars)\/[\w./-]+$/.test(key) || key.includes('..')) {
      throw new NotFoundException();
    }
    if (!this.storage.enabled) throw new NotFoundException();
    const bytes = await this.storage.getBytes(key).catch(() => null);
    if (!bytes) throw new NotFoundException();
    sendFile(res, key, bytes, 'public, max-age=86400');
  }

  /** Приватный файл с диска по подписанной ссылке — как presigned GET у S3. */
  @Get('file')
  async file(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    if (!this.storage.verifyLocal('file', key, exp, sig)) throw new ForbiddenException('Ссылка недействительна');
    const bytes = await this.storage.getBytes(key).catch(() => null);
    if (!bytes) throw new NotFoundException();
    sendFile(res, key, bytes, 'private, max-age=3600');
  }

  /** Загрузка на диск по подписанной ссылке — как presigned PUT у S3. */
  @Put('upload')
  @HttpCode(200)
  async upload(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Req() req: Request,
  ) {
    if (!this.storage.verifyLocal('upload', key, exp, sig)) throw new ForbiddenException('Ссылка недействительна');
    // JSON и формы разбирает общий парсер — файлом они не придут.
    if (req.readableEnded) throw new UnsupportedMediaTypeException('Этот тип файла не загрузить');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_UPLOAD) throw new PayloadTooLargeException('Файл больше 15 МБ');
      chunks.push(chunk as Buffer);
    }
    if (!size) throw new BadRequestException('Пустой файл');
    await this.storage.put(key, Buffer.concat(chunks), mimeOf(key));
    return { ok: true };
  }
}
