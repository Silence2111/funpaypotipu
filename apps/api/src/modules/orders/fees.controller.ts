import { Controller, Get, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import {
  COMPETITOR_RATES_CHECKED,
  GATEWAY_METHOD_KEYS,
  SAFE_DEAL_PAY_METHODS,
  SELLER_LEVELS,
  WITHDRAWAL_METHODS,
  cashbackPct,
  competitorOutcome,
  getWithdrawalMethod,
  sellOutcome,
  type SellOutcome,
} from '@gamemarket/shared';
import { RateLimit } from '../../common/rate-limit';
import { FeesService } from './fees.service';
import { AUTO_GOODS_CONFIRM_MS } from './fulfillment.service';
import { PROMO_DAY_PRICE } from '../listings/listings.service';
import { KYC_REQUIRED_ABOVE, NEWBIE_HOLD_DAYS } from '../payouts/payouts.service';
import { YOOKASSA_METHODS } from '../payments/yookassa.provider';
import { SafeDealService } from '../safe-deal/safe-deal.service';

const LEVEL_DISCOUNTS = Object.values(SELLER_LEVELS).map((l) => l.feeDiscountBps);

/** Калькулятор «Продавать на GameMarket»: раздел и цена в копейках, от 1 ₽ до 10 млн ₽. */
const estimateSchema = z.object({
  categoryId: z.string().uuid(),
  price: z.coerce.number().int().min(100).max(1_000_000_000),
});

const quoteSchema = z.object({
  categoryId: z.string().uuid(),
  price: z.coerce.number().int().positive(),
  currency: z.string().length(3).default('RUB'),
});

@Controller('fees')
export class FeesController {
  constructor(
    private readonly fees: FeesService,
    private readonly safeDeal: SafeDealService,
  ) {}

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
    const scheme = await this.safeDeal.scheme();
    const pcts = rules.map((r) => r.feeSellerPct).filter((v) => v > 0);
    return {
      currency: 'RUB',
      sellerFeeMinPct: pcts.length ? Math.min(...pcts) : 0,
      sellerFeeMaxPct: pcts.length ? Math.max(...pcts) : 0,
      // Скидка уровня — в процентных ПУНКТАХ со ставки, а не доля от неё.
      levelDiscountMaxPp: Math.max(...LEVEL_DISCOUNTS) / 100,
      // В «Безопасной сделке» кэшбэк на паузе: баланс в ней не потратить (часть 123).
      cashbackPct: scheme === 'safe_deal' ? 0 : cashbackPct(),
      // Сколько часов у покупателя на проверку после выдачи: этот срок витрина
      // называет в гарантии сделки. Берём тот же env, что таймер заказов.
      autoConfirmHours: Math.round(
        Number(process.env.ORDER_AUTO_CONFIRM_TTL_MS ?? 72 * 3600 * 1000) / 3600_000,
      ),
      // Сколько часов у продавца на ручную выдачу, потом — авто-возврат (orders-sweep).
      fulfillHours: Math.round(
        Number(process.env.ORDER_FULFILL_DEADLINE_MS ?? 24 * 3600 * 1000) / 3600_000,
      ),
      // Ключи и пополнения: часов на проверку после автоматической выдачи.
      autoGoodsConfirmHours: Math.round(AUTO_GOODS_CONFIRM_MS / 3600_000),
      // Вывод: свыше какой суммы нужна верификация личности и сколько дней
      // ждёт первый вывод у пользователя без продаж — «Помощь» называет их.
      payoutKycAboveMinor: KYC_REQUIRED_ABOVE.toString(),
      payoutNewbieHoldDays: NEWBIE_HOLD_DAYS,
      // Заглушка платежей подтверждает оплату, не приняв денег. Витрина
      // обязана сказать об этом у кнопки «Купить», а не молча «продать».
      paymentsDemo: (process.env.PAYMENT_PROVIDER ?? 'mock') === 'mock',
      // Способы оплаты, которые принимает шлюз: у ЮKassa нет криптовалюты —
      // витрина не предлагает то, что не пройдёт.
      // «Безопасная сделка» (часть 123): только карта, без оплаты с баланса и пополнения.
      payMethods:
        scheme === 'safe_deal'
          ? SAFE_DEAL_PAY_METHODS
          : process.env.PAYMENT_PROVIDER === 'yookassa'
            ? YOOKASSA_METHODS
            : GATEWAY_METHOD_KEYS,
      paymentScheme: scheme,
      // Цена суток продвижения лота, копейки строкой.
      promoDayPrice: PROMO_DAY_PRICE.toString(),
      // Курсы для показа «≈ 10,84 $» рядом с ценой; оплата — в рублях.
      rates: await this.fees.displayRates(),
      withdrawal: WITHDRAWAL_METHODS.map((m) => ({
        key: m.key,
        label: m.label,
        feePct: m.feePct,
        minFeeMinor: m.minFee.toString(),
      })),
    };
  }

  /**
   * «Сколько вы получите» — без входа, для страницы «Продавать на GameMarket».
   * Наша комиссия — по тому же правилу раздела, что и настоящая сделка
   * (для нового продавца, без скидки уровня), вывод — на СБП; FunPay и
   * Playerok — по их опубликованным ставкам. Раньше «сколько на руки» было
   * видно только в форме лота, после регистрации.
   */
  @Get('estimate')
  @RateLimit('fees-estimate', 120, 60)
  async estimate(@Query(new ZodValidationPipe(estimateSchema)) q: { categoryId: string; price: number }) {
    const category = await this.fees.categoryForEstimate(q.categoryId);
    if (!category) throw new NotFoundException('Раздел не найден');
    const price = BigInt(q.price);
    const f = await this.fees.computeForCategory(price, q.categoryId, 'RUB');
    const sbp = getWithdrawalMethod('sbp')!;
    const money = (o: SellOutcome) => ({
      feePct: o.feePct,
      fee: o.fee.toString(),
      payout: o.payout.toString(),
      withdrawFee: o.withdrawFee.toString(),
      net: o.net.toString(),
    });
    return {
      price: price.toString(),
      segment: category.segment,
      ours: money(sellOutcome(price, f.sellerPct, f.feeSeller, sbp)),
      competitors: {
        funpay: money(competitorOutcome('funpay', price, category.segment)),
        playerok: money(competitorOutcome('playerok', price, category.segment)),
      },
      withdrawal: { key: sbp.key, feePct: sbp.feePct, minFee: sbp.minFee.toString() },
      levelDiscountMaxPp: Math.max(...LEVEL_DISCOUNTS) / 100,
      ratesCheckedAt: COMPETITOR_RATES_CHECKED,
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
