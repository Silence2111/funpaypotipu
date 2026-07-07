import { Controller, Get, NotFoundException, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from './storage.service';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

/**
 * Публичная отдача изображений лотов/игр (приватный MinIO наружу не открыт).
 * Разрешены только префиксы listings/ и games/ — вложения чата и KYC остаются приватными.
 */
@Controller('assets')
export class AssetsController {
  constructor(private readonly storage: StorageService) {}

  @Get()
  async serve(@Query('key') key: string, @Res() res: Response) {
    if (!key || !/^(listings|games)\/[\w./-]+$/.test(key) || key.includes('..')) {
      throw new NotFoundException();
    }
    if (!this.storage.enabled) throw new NotFoundException();
    const bytes = await this.storage.getBytes(key).catch(() => null);
    if (!bytes) throw new NotFoundException();
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(bytes);
  }
}
