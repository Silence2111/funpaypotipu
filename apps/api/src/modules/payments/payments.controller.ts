import { Body, Controller, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { GATEWAY_METHOD_KEYS, type GatewayMethodKey } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AccountStatusService } from '../access/account-status.service';
import { PaymentsService } from './payments.service';

// Способ оплаты через шлюз; без него — СБП, как платили до выбора способа.
const methodSchema = z.enum(GATEWAY_METHOD_KEYS).default('sbp');
const depositSchema = z.object({ orderId: z.string().uuid(), method: methodSchema });
const topupSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v))
    .refine((v) => /^\d+$/.test(v) && BigInt(v) > 0n, 'ожидается положительное число минорных единиц'),
  method: methodSchema,
});
const webhookSchema = z.object({
  providerRef: z.string().min(1),
  status: z.enum(['succeeded', 'failed']),
  signature: z.string().min(1),
});

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly account: AccountStatusService,
  ) {}

  @Post('deposit')
  @UseGuards(JwtAuthGuard)
  deposit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(depositSchema)) body: { orderId: string; method: GatewayMethodKey },
  ) {
    return this.payments.createDeposit(body.orderId, user.userId, body.method);
  }

  /** Пополнение баланса пользователя. */
  @Post('topup')
  @UseGuards(JwtAuthGuard)
  async topup(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(topupSchema)) body: { amount: string; method: GatewayMethodKey },
  ) {
    await this.account.assertCanTrade(user.userId);
    return this.payments.createBalanceDeposit(user.userId, BigInt(body.amount), body.method);
  }

  /** Подписанный вебхук провайдера (production-путь). Подпись проверяется провайдером. */
  @Post('webhook/:provider')
  webhook(
    @Param('provider') provider: string,
    @Body(new ZodValidationPipe(webhookSchema))
    body: { providerRef: string; status: 'succeeded' | 'failed'; signature: string },
  ) {
    return this.payments.handleWebhook(provider, body);
  }

  /** Dev-шорткат оплаты для демо (без реального шлюза). */
  @Post('mock/callback')
  callback(@Query('providerRef') providerRef: string) {
    return this.payments.devConfirm(providerRef);
  }
}
