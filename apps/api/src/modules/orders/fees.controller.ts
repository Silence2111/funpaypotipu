import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FeesService } from './fees.service';

const quoteSchema = z.object({
  categoryId: z.string().uuid(),
  price: z.coerce.number().int().positive(),
  currency: z.string().length(3).default('RUB'),
});

@Controller('fees')
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  /** Предпросмотр комиссии для продавца: «покупатель заплатит / вы получите». */
  @Get('quote')
  @UseGuards(JwtAuthGuard)
  async quote(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(quoteSchema))
    q: { categoryId: string; price: number; currency: string },
  ) {
    const f = await this.fees.computeForCategory(
      BigInt(q.price),
      q.categoryId,
      q.currency,
      user.userId,
    );
    return {
      base: f.base.toString(),
      feeSeller: f.feeSeller.toString(),
      sellerPayout: f.sellerPayout.toString(),
      amountToPay: f.amountToPay.toString(),
      currency: q.currency,
      level: f.level ? { key: f.level.key, label: f.level.label } : null,
    };
  }
}
