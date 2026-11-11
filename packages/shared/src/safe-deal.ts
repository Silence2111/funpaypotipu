/**
 * «Безопасная сделка» ЮKassa (часть 123): деньги покупателя держит ЮKassa
 * на сделке, а не площадка; продавцу они уходят выплатой по этой сделке —
 * на карту или в ЮMoney, площадке — её вознаграждение (разница между
 * платежом и выплатой). Документация:
 * yookassa.ru/developers/solutions-for-platforms/safe-deal.
 *
 * Ограничения ЮKassa: в сделке нельзя платить через СБП (и ещё несколько
 * способов), выплата — только на карту физлица или ЮMoney, от 1 ₽ до
 * 150 000 ₽ за раз; сделка живёт до 180 дней, потом ЮKassa сама вернёт
 * деньги покупателю. Баланс площадки в этой схеме не участвует: оплатить
 * заказ с баланса и пополнить его нельзя.
 *
 * Без zod и без Node: модуль идёт и в браузер.
 */

/** Схема оплаты: escrow — деньги на счёте площадки (как было), safe_deal — у ЮKassa. */
export const PAYMENT_SCHEMES = ['escrow', 'safe_deal'] as const;
export type PaymentScheme = (typeof PAYMENT_SCHEMES)[number];
export const PAYMENT_SCHEME_KEY = 'payment_scheme';

/** Способы оплаты в сделке: из наших — только карта (СБП ЮKassa в сделке не принимает). */
export const SAFE_DEAL_PAY_METHODS = ['card'] as const;
/** Куда ЮKassa выплачивает по сделке: карта физлица или кошелёк ЮMoney. */
export const SAFE_DEAL_PAYOUT_METHODS = ['card', 'yoomoney'] as const;
/** Потолок одной выплаты на карту по сделке, копейки. */
export const SAFE_DEAL_PAYOUT_MAX = 15_000_000n;

/** Статусы выплаты продавцу по сделке. */
export const DEAL_PAYOUT_STATUSES = ['waiting', 'sent', 'paid', 'failed'] as const;
export type DealPayoutStatus = (typeof DEAL_PAYOUT_STATUSES)[number];

/**
 * Вознаграждение площадки в сделке — разница между платежом и выплатой
 * продавцу. ЮKassa требует, чтобы оно было больше её комиссии за приём
 * платежа: иначе сделку не открыть (например, промокод съел всю комиссию).
 */
export function safeDealReward(amount: bigint, sellerPayout: bigint): bigint {
  return amount - sellerPayout;
}
