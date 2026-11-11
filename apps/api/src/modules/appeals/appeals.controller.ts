import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RULE_IDS } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { AppealsService } from './appeals.service';

const appealBody = z.object({
  text: z.string().trim().min(10, 'Опишите, почему решение неверно, — от 10 знаков').max(2000),
});

/** Решения модерации о человеке и обжалование (часть 134). */
@Controller('account')
@UseGuards(JwtAuthGuard)
export class AppealsController {
  constructor(private readonly appeals: AppealsService) {}

  @Get('decisions')
  decisions(@CurrentUser() u: AuthUser) {
    return this.appeals.mine(u.userId);
  }

  @Post('decisions/:id/appeal')
  @RateLimit('appeals', 10, 3600)
  appeal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(appealBody)) body: z.infer<typeof appealBody>) {
    return this.appeals.appeal(u.userId, id, body.text);
  }

  @Get('holds')
  holds(@CurrentUser() u: AuthUser) {
    return this.appeals.holdsOf(u.userId);
  }
}

const decideBody = z.object({
  outcome: z.enum(['upheld', 'overturned']),
  note: z.string().trim().min(3, 'Объясните решение — от 3 знаков').max(1000),
});
const holdBody = z.object({
  amount: z.string().regex(/^\d{1,12}$/, 'Сумма — целое число копеек'),
  reason: z.string().trim().min(3, 'Причина — от 3 знаков').max(500),
  rule: z.enum(RULE_IDS as [string, ...string[]]).optional(),
});
const releaseBody = z.object({ note: z.string().trim().min(3, 'Объясните, почему снимаете, — от 3 знаков').max(500) });

/** Обжалования и удержания в консоли. */
@Controller('moderation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'finance')
export class AppealsModerationController {
  constructor(private readonly appeals: AppealsService) {}

  @Get('appeals')
  queue(@Query('status') status?: string) {
    return this.appeals.queue(status === 'decided' ? 'decided' : 'open');
  }

  @Post('appeals/:id/decide')
  @HttpCode(200)
  decide(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(decideBody)) body: z.infer<typeof decideBody>) {
    return this.appeals.decide(u.userId, id, body.outcome, body.note);
  }

  @Get('holds')
  holds() {
    return this.appeals.activeHolds();
  }

  @Post('users/:id/hold')
  @HttpCode(200)
  hold(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(holdBody)) body: z.infer<typeof holdBody>) {
    return this.appeals.hold(u.userId, id, BigInt(body.amount), body.reason, body.rule);
  }

  @Post('holds/:id/release')
  @HttpCode(200)
  release(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(releaseBody)) body: z.infer<typeof releaseBody>) {
    return this.appeals.release(u.userId, id, body.note);
  }
}
