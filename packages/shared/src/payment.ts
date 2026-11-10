/**
 * Способы оплаты заказа и надбавка эквайринга (калибровано по FunPay:
 * карта/Apple Pay/Google Pay ≈ +4.4%, СБП/крипта/баланс — без наценки).
 * Комиссия провайдера НЕ попадает в эскроу — это плата платёжной системе;
 * покупатель видит итоговую цену по каждому методу заранее, как на FunPay.
 */
export interface PaymentMethod {
  key: string;
  label: string;
  feePct: number; // надбавка эквайринга к базовой цене
}

export const PAYMENT_METHODS: PaymentMethod[] = [
  { key: 'balance', label: 'С баланса', feePct: 0 },
  { key: 'sbp', label: 'СБП', feePct: 0 },
  { key: 'crypto', label: 'Криптовалюта (USDT)', feePct: 0 },
  { key: 'card', label: 'Банковская карта', feePct: 0.044 },
  { key: 'applepay', label: 'Apple Pay', feePct: 0.044 },
  { key: 'googlepay', label: 'Google Pay', feePct: 0.044 },
];

/** Итоговая сумма к оплате по методу (минорные единицы), надбавка сверх базы. */
export function priceWithAcquiring(base: bigint, method: PaymentMethod): bigint {
  if (!method.feePct) return base;
  return base + BigInt(Math.round(Number(base) * method.feePct));
}

/** Способы оплаты через платёжный шлюз — всё, кроме баланса. */
export const GATEWAY_METHOD_KEYS = ['sbp', 'card', 'applepay', 'googlepay', 'crypto'] as const;
export type GatewayMethodKey = (typeof GATEWAY_METHOD_KEYS)[number];

/**
 * Сколько шлюз возьмёт с покупателя сверх суммы заказа и что из этого —
 * надбавка способа оплаты. Одна функция для витрины и для депозита: цена
 * на кнопке и сумма платежа не расходятся.
 */
export function chargeFor(base: bigint, methodKey: string): { charge: bigint; surcharge: bigint } {
  const method = PAYMENT_METHODS.find((m) => m.key === methodKey);
  if (!method) throw new Error(`Неизвестный способ оплаты: ${methodKey}`);
  const charge = priceWithAcquiring(base, method);
  return { charge, surcharge: charge - base };
}
