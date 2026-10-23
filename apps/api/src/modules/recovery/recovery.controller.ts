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
  RECOVERY_REASONS,
  RecoveryService,
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
});
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
    body: { email: string; reason: RecoveryReason; orderNumbers: string[]; details: string },
    @Req() req: Request,
  ) {
    return this.recovery.request(body, ctxOf(req));
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
