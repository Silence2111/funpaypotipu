import { Body, Controller, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';

const depositSchema = z.object({ orderId: z.string().uuid() });
const webhookSchema = z.object({
  providerRef: z.string().min(1),
  status: z.enum(['succeeded', 'failed']),
  signature: z.string().min(1),
});

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('deposit')
  @UseGuards(JwtAuthGuard)
  deposit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(depositSchema)) body: { orderId: string },
  ) {
    return this.payments.createDeposit(body.orderId, user.userId);
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
