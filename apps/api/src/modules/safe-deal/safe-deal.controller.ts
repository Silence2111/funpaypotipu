import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PAYMENT_SCHEMES } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { SafeDealService } from './safe-deal.service';

const schemeSchema = z.object({ scheme: z.enum(PAYMENT_SCHEMES) });

/** Схема оплаты в консоли (часть 123): escrow или «Безопасная сделка» ЮKassa. */
@Controller('admin/payment-scheme')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SafeDealController {
  constructor(private readonly safeDeal: SafeDealService) {}

  @Get()
  async get() {
    return { scheme: await this.safeDeal.scheme() };
  }

  @Put()
  set(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(schemeSchema)) body: z.infer<typeof schemeSchema>) {
    return this.safeDeal.setScheme(u.userId, body.scheme);
  }
}
