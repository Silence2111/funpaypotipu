import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { ReconciliationService } from './reconciliation.service';
import { OpsWatchService, thresholds } from './ops-watch.service';
import { OpsAlertService } from './ops-alert.service';
import { ErrorMonitorService } from './error-monitor.service';
import { FunnelService } from './funnel.service';
import { opsError } from './ops-signal';

const runSchema = z.object({
  hours: z
    .number()
    .int()
    .min(1)
    .max(24 * 31)
    .optional(),
});
const resolveSchema = z.object({ note: z.string().trim().min(3).max(500) });
// Ошибка со страницы сайта: текст, стек и адрес страницы — обрезанные.
const clientErrorSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  stack: z.string().max(8000).optional(),
  path: z.string().max(300).optional(),
});

/**
 * Консоль «Сверка и сбои» (части 129–131): сверка с ЮKassa и её
 * расхождения, правила тревог и последние тревоги — финансам и
 * администратору; группы ошибок — только администратору (в тексте ошибки
 * бывают данные пользователей). Воронка запуска — им же.
 */
@Controller()
export class OpsController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly watch: OpsWatchService,
    private readonly alerts: OpsAlertService,
    private readonly errors: ErrorMonitorService,
    private readonly funnel: FunnelService,
  ) {}

  @Get('admin/ops')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('finance')
  async overview(@Query('resolved') resolved?: string) {
    const [rec, state, alerts] = await Promise.all([
      this.reconciliation.overview({ resolved: resolved === '1' }),
      this.watch.state(),
      this.alerts.recent(),
    ]);
    return {
      reconciliation: rec,
      watch: {
        state,
        thresholds: thresholds(),
        telegram: !!(process.env.ALERT_BOT_TOKEN && process.env.ALERT_CHAT_ID),
      },
      alerts,
    };
  }

  @Post('admin/ops/reconcile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('finance')
  @HttpCode(200)
  reconcile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(runSchema)) body: { hours?: number },
  ) {
    return this.reconciliation.run({ trigger: 'manual', hours: body.hours, by: user.userId });
  }

  @Post('admin/ops/issues/:id/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('finance')
  @HttpCode(200)
  resolveIssue(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resolveSchema)) body: { note: string },
  ) {
    return this.reconciliation.resolve(id, user.userId, body.note);
  }

  @Get('admin/ops/errors')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async errorGroups(@Query('resolved') resolved?: string) {
    await this.errors.flush();
    return this.errors.list({ resolved: resolved === '1' });
  }

  @Post('admin/ops/errors/:id/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(200)
  resolveError(@Param('id', ParseUUIDPipe) id: string) {
    return this.errors.resolve(id);
  }

  /** Проверить правила тревог сейчас, не дожидаясь минуты. */
  @Post('admin/ops/check')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(200)
  async check() {
    await this.errors.flush();
    return this.watch.check();
  }

  @Get('admin/funnel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('finance')
  funnelReport(@Query('days') days?: string) {
    return this.funnel.funnel(Number(days ?? 30));
  }

  /**
   * Настоящая ошибка 500 — только для e2e (OPS_TEST_ERRORS=1) и не в бою:
   * так сценарий проверяет, что непойманное исключение попадает в сбор.
   */
  @Post('ops/test-error')
  testError() {
    if (process.env.OPS_TEST_ERRORS !== '1' || process.env.NODE_ENV === 'production')
      throw new NotFoundException();
    throw new Error(`e2e boom ${randomUUID()}`);
  }

  /** Ошибка со страницы сайта — без входа: падает и у гостей. Лимит — от мусора. */
  @Post('ops/client-error')
  @HttpCode(204)
  @RateLimit('client-error', 20, 60)
  clientError(
    @Body(new ZodValidationPipe(clientErrorSchema)) body: z.infer<typeof clientErrorSchema>,
  ) {
    opsError({
      source: 'web',
      message: body.message,
      stack: body.stack ?? null,
      path: body.path ?? null,
      context: 'web',
    });
  }
}
