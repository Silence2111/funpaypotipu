import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { RetentionService } from './retention.service';
import { RegistryCheckService } from './registry-check.service';

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/**
 * Акты об уничтожении в консоли (часть 147): список, акт для печати и
 * подписи, выгрузка из журнала, отметка «подписан». Только администратор.
 */
@Controller('admin/erasure')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class RetentionController {
  constructor(
    private readonly retention: RetentionService,
    private readonly registry: RegistryCheckService,
  ) {}

  /** Пороги реестра по 289-ФЗ (часть 145): прошлый год и текущий на сегодня. */
  @Get('registry')
  registryStatus() {
    return this.registry.status();
  }

  @Get('acts')
  list(@Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.retention.listActs(q.limit);
  }

  @Get('acts/:id/act')
  async act(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.retention.actHtml(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    res.setHeader('Cache-Control', 'no-store');
    return file.html;
  }

  @Get('acts/:id/journal.csv')
  async journal(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.retention.journalCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    res.setHeader('Cache-Control', 'no-store');
    return file.csv;
  }

  @Post('acts/:id/sign')
  sign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.retention.sign(id, u.userId);
  }
}
