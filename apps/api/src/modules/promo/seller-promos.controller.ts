import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SELLER_PROMO_MAX_PCT, SELLER_PROMO_MIN_PCT } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { SellerPromosService, type SellerPromoInput } from './seller-promos.service';

const createSchema = z.object({
  code: z.string().trim().min(1, 'Укажите код').max(20, 'Код — до 20 знаков'),
  percent: z
    .number()
    .int()
    .min(SELLER_PROMO_MIN_PCT, `Скидка — от ${SELLER_PROMO_MIN_PCT}%`)
    .max(SELLER_PROMO_MAX_PCT, `Скидка — до ${SELLER_PROMO_MAX_PCT}%`),
  maxUses: z.number().int().min(1, 'Использований — от одного').max(10_000).nullish(),
  days: z.number().int().min(1, 'Срок — от суток').max(365, 'Срок — до года').nullish(),
  repeatOnly: z.boolean().optional(),
});

/** Промокоды продавца: «Инструменты → Промокоды». */
@Controller('seller-promos')
@UseGuards(JwtAuthGuard)
export class SellerPromosController {
  constructor(private readonly promos: SellerPromosService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.promos.list(user.userId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: SellerPromoInput,
  ) {
    return this.promos.create(user.userId, body);
  }

  @Patch(':id')
  setActive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(z.object({ active: z.boolean() }))) body: { active: boolean },
  ) {
    return this.promos.setActive(user.userId, id, body.active);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.promos.remove(user.userId, id);
  }
}
