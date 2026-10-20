import { Body, Controller, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { GATEWAY_METHOD_KEYS, type GatewayMethodKey } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AccountStatusService } from '../access/account-status.service';
import { PaymentsService } from './payments.service';
import { RateLimit } from '../../common/rate-limit';

// Способ оплаты через шлюз; без него — СБП, как платили до выбора способа.
const methodSchema = z.enum(GATEWAY_METHOD_KEYS).default('sbp');
const depositSchema = z.object({ orderId: z.string().uuid(), method: methodSchema });
const topupSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v))
    .refine((v) => /^\d+$/.test(v) && BigInt(v) > 0n, 'ожидается положительное число минорных единиц'),
  method: methodSchema,
});

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly account: AccountStatusService,
  ) {}

  @Post('deposit')
  @RateLimit('payments', 30, 600)
  @UseGuards(JwtAuthGuard)
  deposit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(depositSchema)) body: { orderId: string; method: GatewayMethodKey },
  ) {
    return this.payments.createDeposit(body.orderId, user.userId, body.method);
  }

  /** Пополнение баланса пользователя. */
  @Post('topup')
  @RateLimit('payments', 30, 600)
  @UseGuards(JwtAuthGuard)
  async topup(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(topupSchema)) body: { amount: string; method: GatewayMethodKey },
  ) {
    await this.account.assertCanTrade(user.userId);
    return this.payments.createBalanceDeposit(user.userId, BigInt(body.amount), body.method);
  }

  /**
   * Вебхук провайдера (production-путь). Тело у каждого шлюза своё — его
   * разбирает и проверяет провайдер: заглушка — по HMAC-подписи, ЮKassa —
   * запросом статуса платежа в своём API. Ответ 200 — «принято, не повторять».
   */
  @Post('webhook/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Body() body: unknown) {
    return this.payments.handleWebhook(provider, body);
  }

  /** Dev-шорткат оплаты для демо (без реального шлюза). */
  @Post('mock/callback')
  callback(@Query('providerRef') providerRef: string) {
    return this.payments.devConfirm(providerRef);
  }
}
