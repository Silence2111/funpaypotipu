import { Body, Controller, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PaymentsService } from './payments.service';

const depositSchema = z.object({ orderId: z.string().uuid() });

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

  /** Имитация вебхука провайдера (в dev). В проде — верифицированный вебхук. */
  @Post('mock/callback')
  callback(@Query('providerRef') providerRef: string) {
    return this.payments.handleCallback(providerRef);
  }
}
