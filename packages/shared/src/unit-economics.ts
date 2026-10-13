/**
 * Сходится ли сделка для самой площадки.
 *
 * ## Что не сходилось
 *
 * Комиссия считалась (`computeFees`), скидка по уровню продавца считалась
 * (`sellerLevel`), промокод считался (`PromoService`), кэшбэк считался
 * (`OrdersService`). Не считалось только одно: **что остаётся площадке
 * после всех четырёх**. Каждый кусок по отдельности выглядел разумно,
 * а вместе они складывались в минус, и увидеть это было негде.
 *
 * Конкретно, на заказе 1 000 ₽ в категории ключей:
 *
 * | Что | Сколько |
 * |---|---|
 * | комиссия продавца, 7% | +70 ₽ |
 * | скидка Pro-продавца, −3 п.п. | −30 ₽ |
 * | промокод, ограничен «комиссией площадки» | −40 ₽ |
 * | кэшбэк покупателю, 2% от суммы | −20 ₽ |
 * | приём платежа по СБП, с покупателя 0% | −7 ₽ |
 * | **итого площадке** | **−27 ₽** |
 *
 * Промокод упирался в потолок `amountToPay - sellerPayout`, то есть ровно
 * в валовую комиссию. После этого кэшбэк и эквайринг платились уже из
 * своего кармана. Чем удачнее промоакция, тем больше убыток.
 *
 * ## Что здесь считается
 *
 * Всё, что уходит из комиссии, и то, что остаётся. Плюс потолок скидки,
 * ниже которого промокод опускать нельзя: `maxPromoDiscount`.
 *
 * ## Про ставки эквайринга
 *
 * `PAYMENT_METHODS` описывает надбавку **для покупателя**: карта +4.4%,
 * СБП/крипта/баланс без наценки. Но «без наценки для покупателя» не значит
 * «бесплатно для нас»: СБП стоит торговой точке десятые доли процента,
 * приём крипты — около процента. Эти доли нигде не учитывались, потому что
 * на витрине их не видно.
 *
 * Значения по умолчанию взяты консервативно (верх обычного коридора) и
 * переопределяются переменными окружения — их надо выставить по реальному
 * договору с провайдером, а не оставлять как есть.
 *
 * Надбавку карты (+4.4%) покупатель теперь платит на самом деле, поэтому
 * эквайринг здесь — нетто: комиссия провайдера с полной суммы платежа минус
 * надбавка. У карты он бывает отрицательным: надбавка больше комиссии.
 */

import type { Minor } from './money';
import { PAYMENT_METHODS, priceWithAcquiring, type PaymentMethod } from './payment';

const num = (raw: string | undefined, fallback: number): number => {
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

// Пакет `shared` собирается и для браузера, поэтому `process` здесь читается
// через globalThis: в вебе его просто нет, и тогда работают значения по умолчанию.
const envOf = (key: string): string | undefined => {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.[key];
};

/** Во сколько приём платежа обходится ПЛОЩАДКЕ, по ключу метода. */
export const acquiringCostPct = (methodKey: string): number => {
  switch (methodKey) {
    case 'balance':
      // Деньги уже внутри периметра: второй раз за них никто не берёт.
      return 0;
    case 'sbp':
      return num(envOf('ACQUIRING_SBP_PCT'), 0.007);
    case 'crypto':
      return num(envOf('ACQUIRING_CRYPTO_PCT'), 0.01);
    default:
      // Карты: с покупателя берём 4.4%, провайдеру отдаём около 3%.
      return num(envOf('ACQUIRING_CARD_PCT'), 0.03);
  }
};

/**
 * Доля кэшбэка покупателю — единственный источник. `OrdersService` раньше
 * держал свою копию `Number(process.env.LOYALTY_CASHBACK_PCT ?? 0.02)` без
 * проверки: при опечатке в переменной витрина показывала 2%, а начисление
 * получало NaN и падало на `BigInt(NaN)` в момент завершения заказа.
 */
export const cashbackPct = (): number => num(envOf('LOYALTY_CASHBACK_PCT'), 0.02);

/**
 * Сумма кэшбэка по заказу. Округление вниз — как при реальном начислении:
 * расчёт экономики и выплата должны давать одну и ту же копейку.
 */
export const cashbackFor = (amount: Minor): Minor =>
  BigInt(Math.floor(Number(amount) * cashbackPct()));

/**
 * Минимальная доля от суммы заказа, которая должна остаться площадке.
 * Ноль означал бы «работаем в ноль»: серверы, поддержка и споры бесплатными
 * не становятся. Полпроцента — не прибыль, а граница, ниже которой сделка
 * точно убыточна.
 */
export const minMarginPct = (): number => num(envOf('MIN_DEAL_MARGIN_PCT'), 0.005);

export interface DealInput {
  /** Сумма, которую платит покупатель, до промокода. */
  amountToPay: Minor;
  /** Сколько получает продавец. */
  sellerPayout: Minor;
  /** Скидка по промокоду. */
  promoDiscount?: Minor;
  /** Ключ способа оплаты (`PAYMENT_METHODS`). */
  paymentMethod?: string;
}

export interface DealEconomics {
  /** Валовая комиссия до скидок: то, что видно в `FeeBreakdown`. */
  grossRevenue: Minor;
  promoDiscount: Minor;
  cashback: Minor;
  /** Надбавка способа оплаты, которую заплатил покупатель сверх суммы. */
  surcharge: Minor;
  /** Приём платежа нетто: комиссия провайдера минус надбавка. Может быть < 0. */
  acquiringCost: Minor;
  /** Что реально остаётся площадке. */
  net: Minor;
  /** Доля от суммы заказа. */
  marginPct: number;
  /** Проходит ли сделка по нижней границе. */
  ok: boolean;
}

const pctOf = (amount: Minor, pct: number): Minor =>
  BigInt(Math.round(Number(amount) * pct));

export function dealEconomics(input: DealInput): DealEconomics {
  const { amountToPay, sellerPayout } = input;
  const promoDiscount = input.promoDiscount ?? 0n;
  const grossRevenue = amountToPay - sellerPayout;

  // Покупатель платит меньше на скидку — кэшбэк и эквайринг считаются
  // от того, что он заплатил на самом деле.
  const key = input.paymentMethod ?? 'balance';
  const charged = amountToPay - promoDiscount;
  const cashback = cashbackFor(charged);
  const method = paymentMethodByKey(key);
  const surcharge = method ? priceWithAcquiring(charged, method) - charged : 0n;
  // Провайдер берёт комиссию со всего платежа, включая надбавку.
  const acquiringCost = pctOf(charged + surcharge, acquiringCostPct(key)) - surcharge;

  const net = grossRevenue - promoDiscount - cashback - acquiringCost;
  const denom = Number(charged);
  const marginPct = denom > 0 ? Number(net) / denom : 0;

  return {
    grossRevenue,
    promoDiscount,
    cashback,
    surcharge,
    acquiringCost,
    net,
    marginPct,
    ok: net > 0n && marginPct >= minMarginPct(),
  };
}

/**
 * Насколько можно опустить цену промокодом, чтобы сделка осталась в плюсе.
 *
 * Раньше потолком была вся валовая комиссия — то есть промокод разрешалось
 * доводить ровно до нуля, после чего кэшбэк и эквайринг уходили в минус.
 * Теперь из комиссии сначала вычитается то, что площадка и так заплатит.
 */
export function maxPromoDiscount(input: Omit<DealInput, 'promoDiscount'>): Minor {
  const { amountToPay, sellerPayout } = input;
  const grossRevenue = amountToPay - sellerPayout;
  if (grossRevenue <= 0n) return 0n;

  // Промокод применяется при создании заказа, а способ оплаты выбирают
  // потом. Не выбран — потолок по самому дорогому для площадки способу.
  if (input.paymentMethod === undefined) {
    return PAYMENT_METHODS.reduce(
      (min, m) => {
        const v = maxPromoDiscount({ ...input, paymentMethod: m.key });
        return v < min ? v : min;
      },
      grossRevenue,
    );
  }

  const rate = cashbackPct() + netAcquiringPct(input.paymentMethod) + minMarginPct();
  // Скидка d уменьшает и базу для кэшбэка с эквайрингом:
  //   revenue − d − (amount − d)·rate ≥ 0  →  d ≤ (revenue − amount·rate) / (1 − rate)
  const headroom = Number(grossRevenue) - Number(amountToPay) * rate;
  if (headroom <= 0) return 0n;

  const limit = BigInt(Math.floor(headroom / (1 - rate)));
  return limit > grossRevenue ? grossRevenue : limit;
}

/**
 * Нетто-эквайринг на рубль заказа: комиссия провайдера с суммы вместе с
 * надбавкой минус сама надбавка. Карта: 3% × 1.044 − 4.4% ≈ −1.3%.
 */
const netAcquiringPct = (key: string): number => {
  const fee = paymentMethodByKey(key)?.feePct ?? 0;
  return acquiringCostPct(key) * (1 + fee) - fee;
};

/** Строка для журнала и для админки. */
export function explainDeal(e: DealEconomics): string {
  const rub = (v: Minor) => (Number(v) / 100).toFixed(2);
  const acquiring =
    e.acquiringCost >= 0n
      ? `эквайринг ${rub(e.acquiringCost)} ₽`
      : `надбавка за способ оплаты сверх эквайринга ${rub(-e.acquiringCost)} ₽`;
  if (e.net > 0n) {
    return (
      `Комиссия ${rub(e.grossRevenue)} ₽, скидка ${rub(e.promoDiscount)} ₽, ` +
      `кэшбэк ${rub(e.cashback)} ₽, ${acquiring} → ` +
      `площадке ${rub(e.net)} ₽ (${(e.marginPct * 100).toFixed(1)}%).`
    );
  }
  return (
    `Сделка убыточна: комиссия ${rub(e.grossRevenue)} ₽ не покрывает ` +
    `скидку ${rub(e.promoDiscount)} ₽, кэшбэк ${rub(e.cashback)} ₽ и ` +
    `${acquiring}. Площадка теряет ${rub(-e.net)} ₽.`
  );
}

/** Метод оплаты по ключу — для UI и расчётов. */
export const paymentMethodByKey = (key: string): PaymentMethod | undefined =>
  PAYMENT_METHODS.find((m) => m.key === key);
