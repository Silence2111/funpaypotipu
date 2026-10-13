import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import {
  SELLER_LEVELS,
  WITHDRAWAL_METHODS,
  cashbackPct,
} from '@gamemarket/shared';
import { FeesService } from './fees.service';
import { PROMO_DAY_PRICE } from '../listings/listings.service';

const LEVEL_DISCOUNTS = Object.values(SELLER_LEVELS).map((l) => l.feeDiscountBps);

const quoteSchema = z.object({
  categoryId: z.string().uuid(),
  price: z.coerce.number().int().positive(),
  currency: z.string().length(3).default('RUB'),
});

@Controller('fees')
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  /**
   * Публичный прайс площадки — для витрины.
   *
   * Цифры на лендинге раньше были бы обычным маркетинговым текстом: поменял
   * кто-нибудь правило комиссии в админке — и главная продолжает обещать
   * старое. Здесь ставки отдаются из тех же `FeeRule`, по которым считается
   * реальная сделка, плюс ставки вывода и кэшбэк.
   */
  @Get('public')
  async publicPricing() {
    const rules = await this.fees.activeRules('RUB');
    const pcts = rules.map((r) => r.feeSellerPct).filter((v) => v > 0);
    return {
      currency: 'RUB',
      sellerFeeMinPct: pcts.length ? Math.min(...pcts) : 0,
      sellerFeeMaxPct: pcts.length ? Math.max(...pcts) : 0,
      // Скидка уровня — в процентных ПУНКТАХ со ставки, а не доля от неё.
      levelDiscountMaxPp: Math.max(...LEVEL_DISCOUNTS) / 100,
      cashbackPct: cashbackPct(),
      // Сколько часов у покупателя на проверку после выдачи: этот срок витрина
      // называет в гарантии сделки. Берём тот же env, что таймер заказов.
      autoConfirmHours: Math.round(
        Number(process.env.ORDER_AUTO_CONFIRM_TTL_MS ?? 72 * 3600 * 1000) / 3600_000,
      ),
      // Сколько часов у продавца на ручную выдачу, потом — авто-возврат (orders-sweep).
      fulfillHours: Math.round(
        Number(process.env.ORDER_FULFILL_DEADLINE_MS ?? 24 * 3600 * 1000) / 3600_000,
      ),
      // Заглушка платежей подтверждает оплату, не приняв денег. Витрина
      // обязана сказать об этом у кнопки «Купить», а не молча «продать».
      paymentsDemo: (process.env.PAYMENT_PROVIDER ?? 'mock') === 'mock',
      // Цена суток продвижения лота, копейки строкой.
      promoDayPrice: PROMO_DAY_PRICE.toString(),
      withdrawal: WITHDRAWAL_METHODS.map((m) => ({
        key: m.key,
        label: m.label,
        feePct: m.feePct,
        minFeeMinor: m.minFee.toString(),
      })),
    };
  }

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
