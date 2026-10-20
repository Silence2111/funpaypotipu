import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { WITHDRAWAL_METHOD_KEYS } from '@gamemarket/shared';
import { AccountStatusService } from '../access/account-status.service';
import { PayoutsService } from './payouts.service';
import { RateLimit } from '../../common/rate-limit';

const requestSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v))
    .refine((v) => /^\d+$/.test(v), 'ожидается целое число минорных единиц'),
  method: z.enum(WITHDRAWAL_METHOD_KEYS),
  destination: z.string().min(4).max(200),
  // Банк для выплаты по СБП через ЮKassa — из GET /payouts/sbp-banks.
  bankId: z.string().max(32).optional(),
});
const rejectSchema = z.object({ reason: z.string().max(500).optional() });

@Controller('payouts')
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly account: AccountStatusService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async request(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(requestSchema))
    body: { amount: string; method: string; destination: string; bankId?: string },
  ) {
    await this.account.assertCanTrade(user.userId);
    return this.payouts.request(user.userId, BigInt(body.amount), body.method, body.destination, 'RUB', body.bankId);
  }

  /** Банки СБП для выплаты; пусто — выплаты по СБП вручную. */
  @Get('sbp-banks')
  @UseGuards(JwtAuthGuard)
  sbpBanks() {
    return this.payouts.sbpBanks();
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.payouts.listMine(user.userId);
  }

  @Get('methods')
  @UseGuards(JwtAuthGuard)
  methods() {
    return this.payouts.listMethods();
  }

  // ── Финансовый оператор ──
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('finance')
  list(@Query('status') status?: 'requested' | 'approved' | 'processing' | 'paid' | 'rejected') {
    return this.payouts.list(status);
  }

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('finance')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payouts.approve(id, user.userId);
  }

  @Post(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('finance')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: { reason?: string },
  ) {
    return this.payouts.reject(id, user.userId, body.reason);
  }

  /**
   * Уведомление ЮKassa о выплате — без входа: его шлёт шлюз. Статус и сумму
   * сервис перечитывает в API ЮKassa, телу запроса не верит.
   */
  @Post('webhook/yookassa')
  @HttpCode(200)
  @RateLimit('webhook', 1200, 60)
  webhook(@Body() body: unknown) {
    return this.payouts.webhook(body);
  }
}
