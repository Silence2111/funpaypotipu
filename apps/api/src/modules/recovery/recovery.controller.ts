import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ctxOf } from '../auth/auth-http';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import {
  DEAL_ANSWERS,
  RECOVERY_REASONS,
  RecoveryService,
  type DealAnswer,
  type RecoveryReason,
  type RecoveryStatus,
} from './recovery.service';

const requestSchema = z.object({
  email: z.string().trim().email().max(200),
  reason: z.enum(RECOVERY_REASONS),
  orderNumbers: z
    .array(z.string().trim().max(40))
    .max(3, 'Не больше трёх номеров заказов')
    .default([]),
  details: z.string().trim().min(10, 'Опишите, что случилось, — от 10 символов').max(2000),
  // Нет доступа и к почте аккаунта — куда ответить.
  newEmail: z.string().trim().email().max(200).optional(),
});
const tokenSchema = z.object({ token: z.string().min(10).max(2000) });
const uploadSchema = tokenSchema.extend({ mime: z.string().max(100) });
const docsSchema = tokenSchema.extend({
  documentKeys: z.array(z.string().max(300)).min(1).max(2),
  selfieKey: z.string().max(300),
});
const dealsSchema = tokenSchema.extend({
  deals: z
    .array(
      z.object({
        counterparty: z.string().trim().min(2, 'Укажите ник продавца или покупателя').max(40),
        text: z
          .string()
          .trim()
          .min(20, 'Опишите сделку подробнее — от 20 символов')
          .max(600, 'Описание сделки — до 600 символов'),
      }),
    )
    .min(2, 'Опишите хотя бы две сделки')
    .max(3, 'Не больше трёх сделок'),
});
const answerSchema = z.object({ answer: z.enum(DEAL_ANSWERS) });
const rejectSchema = z.object({
  note: z.string().trim().min(5, 'Причина — от 5 символов').max(1000),
});

/** «Не могу войти»: заявка без входа, отметка владельца и решение сотрудника. */
@Controller('recovery')
export class RecoveryController {
  constructor(private readonly recovery: RecoveryService) {}

  @Post()
  @RateLimit('recovery', 5, 3600)
  request(
    @Body(new ZodValidationPipe(requestSchema))
    body: {
      email: string;
      reason: RecoveryReason;
      orderNumbers: string[];
      details: string;
      newEmail?: string;
    },
    @Req() req: Request,
  ) {
    return this.recovery.request(body, ctxOf(req));
  }

  // ── Документы по ссылке «Загрузите документы» — без входа, по токену из письма ──

  @Post('docs/status')
  @HttpCode(200)
  @RateLimit('recovery-docs', 60, 3600)
  docsStatus(@Body(new ZodValidationPipe(tokenSchema)) body: { token: string }) {
    return this.recovery.docsStatus(body.token);
  }

  @Post('docs/uploads')
  @RateLimit('recovery-docs', 60, 3600)
  docsUpload(@Body(new ZodValidationPipe(uploadSchema)) body: { token: string; mime: string }) {
    return this.recovery.docsUpload(body.token, body.mime);
  }

  @Post('docs')
  @RateLimit('recovery-docs', 60, 3600)
  docsSubmit(
    @Body(new ZodValidationPipe(docsSchema))
    body: {
      token: string;
      documentKeys: string[];
      selfieKey: string;
    },
  ) {
    return this.recovery.docsSubmit(body.token, body.documentKeys, body.selfieKey);
  }

  // ── Сделки по ссылке «Опишите сделки» — без входа, по токену из письма ──

  @Post('deals/status')
  @HttpCode(200)
  @RateLimit('recovery-deals', 60, 3600)
  dealsStatus(@Body(new ZodValidationPipe(tokenSchema)) body: { token: string }) {
    return this.recovery.dealsStatus(body.token);
  }

  @Post('deals')
  @RateLimit('recovery-deals', 60, 3600)
  dealsSubmit(
    @Body(new ZodValidationPipe(dealsSchema))
    body: { token: string; deals: Array<{ counterparty: string; text: string }> },
    @Req() req: Request,
  ) {
    return this.recovery.dealsSubmit(body.token, body.deals, ctxOf(req).ip);
  }

  // ── Проверка картой по ссылке из письма — без входа, по токену ──

  @Post('card/status')
  @HttpCode(200)
  @RateLimit('recovery-card', 120, 3600)
  cardStatus(@Body(new ZodValidationPipe(tokenSchema)) body: { token: string }) {
    return this.recovery.cardStatus(body.token);
  }

  @Post('card/pay')
  @HttpCode(200)
  @RateLimit('recovery-card-pay', 10, 3600)
  cardPay(@Body(new ZodValidationPipe(tokenSchema)) body: { token: string }) {
    return this.recovery.cardPay(body.token);
  }

  // ── Другая сторона сделки: просьбы подтвердить и ответ ──

  @Get('checks')
  @UseGuards(JwtAuthGuard)
  checks(@CurrentUser() user: AuthUser) {
    return this.recovery.checks(user.userId);
  }

  @Post('checks/:id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  answerCheck(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(answerSchema)) body: { answer: DealAnswer },
    @Req() req: Request,
  ) {
    return this.recovery.answerCheck(user.userId, id, body.answer, ctxOf(req).ip);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.recovery.mine(user.userId);
  }

  @Get('queue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('agent', 'moderator')
  queue(@Query('status') status?: string) {
    const s = (['pending', 'restored', 'rejected'] as const).find((v) => v === status) ?? 'pending';
    return this.recovery.queue(s as RecoveryStatus);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('agent', 'moderator')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.recovery.detail(id);
  }

  @Post(':id/object')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  object(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.recovery.object(user.userId, id, ctxOf(req));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('agent', 'moderator')
  restore(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.recovery.restore(id, user.userId, ctxOf(req).ip);
  }

  /** Попросить документы ссылкой на новую почту из заявки. */
  @Post(':id/request-docs')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('agent', 'moderator')
  requestDocs(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.recovery.requestEvidence(id, user.userId, ctxOf(req).ip);
  }

  /** Проверки личности нет — попросить описать сделки ссылкой на новую почту. */
  @Post(':id/request-deals')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('agent', 'moderator')
  requestDeals(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.recovery.requestDeals(id, user.userId, ctxOf(req).ip);
  }

  /** Попросить проверку картой ссылкой на новую почту. */
  @Post(':id/request-card')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('agent', 'moderator')
  requestCard(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.recovery.requestCard(id, user.userId, ctxOf(req).ip);
  }

  @Post(':id/restore-new-email')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('agent', 'moderator')
  restoreNewEmail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.recovery.restoreToNewEmail(id, user.userId, ctxOf(req).ip);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('agent', 'moderator')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: { note: string },
    @Req() req: Request,
  ) {
    return this.recovery.reject(id, user.userId, body.note, ctxOf(req).ip);
  }
}
