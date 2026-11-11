/**
 * Куда вернуть деньги при отмене (часть 137): на баланс — сразу, сумма
 * заказа, надбавка способа оплаты не возвращается; исходным способом —
 * через шлюз всё, что списали, вместе с надбавкой, банк зачисляет 1–10
 * дней. Выбирает покупатель.
 *
 * Без zod и без Node: модуль идёт и в браузер.
 */

export type RefundTo = 'balance' | 'original';

/** Способы, по которым шлюз возвращает деньги; криптовалюту и баланс — нет. */
export const REFUNDABLE_METHODS = ['card', 'sbp', 'applepay', 'googlepay'] as const;

export function canRefundToOriginal(o: { paymentMethod?: string | null; dealId?: string | null }): boolean {
  return !o.dealId && !!o.paymentMethod && (REFUNDABLE_METHODS as readonly string[]).includes(o.paymentMethod);
}

/** Сколько вернётся: на баланс — сумма заказа; исходным способом — плюс надбавка. */
export function refundAmount(o: { amount: bigint; paymentSurcharge?: bigint | null }, to: RefundTo): bigint {
  return to === 'original' ? o.amount + (o.paymentSurcharge ?? 0n) : o.amount;
}
