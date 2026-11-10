/**
 * Методы вывода средств. Ставки СОЗНАТЕЛЬНО ниже Playerok
 * (у них СБП/карта/ЮMoney 6% мин 60₽, USDT 4%+1$, иностр. карта 10%) —
 * это прямой аргумент для продавца. Суммы — в минорных единицах (копейки).
 */
export interface WithdrawalMethod {
  key: string;
  label: string;
  feePct: number; // доля, напр. 0.04 = 4%
  minFee: bigint; // минимальная комиссия
  minAmount: bigint; // минимальная сумма вывода
  maxAmount: bigint;
}

// Ставки ниже обоих конкурентов: FunPay 3% (мин 30₽), Playerok 6% (мин 60₽).
export const WITHDRAWAL_METHODS: WithdrawalMethod[] = [
  { key: 'sbp', label: 'СБП', feePct: 0.025, minFee: 2500n, minAmount: 30000n, maxAmount: 7_900_000n },
  { key: 'card', label: 'Банковская карта', feePct: 0.025, minFee: 2500n, minAmount: 30000n, maxAmount: 7_900_000n },
  { key: 'usdt', label: 'USDT (TRC20)', feePct: 0.015, minFee: 0n, minAmount: 50000n, maxAmount: 50_000_000n },
  { key: 'yoomoney', label: 'ЮMoney', feePct: 0.025, minFee: 2500n, minAmount: 30000n, maxAmount: 7_900_000n },
];

export const WITHDRAWAL_METHOD_KEYS = WITHDRAWAL_METHODS.map((m) => m.key) as [string, ...string[]];

export function getWithdrawalMethod(key: string): WithdrawalMethod | undefined {
  return WITHDRAWAL_METHODS.find((m) => m.key === key);
}

/**
 * Частые причины отказа в выводе — подсказки сотруднику в консоли. Выбранную
 * как есть продавец видит на своём языке (перевод — в общем словаре);
 * поправленную или свою — как написал сотрудник.
 */
export const PAYOUT_REJECT_REASONS = [
  'Реквизиты не на ваше имя — укажите свои',
  'Реквизиты с ошибкой — проверьте номер и создайте заявку заново',
  'Нужна проверка личности: «Безопасность» → «Проверка личности»',
  'Деньги за сделку в споре — вывод после его решения',
] as const;

/** Причина отказа — подсказка из списка, слово в слово? Тогда её можно перевести. */
export const isPayoutRejectReason = (text: string) =>
  (PAYOUT_REJECT_REASONS as readonly string[]).includes(text);

/** Комиссия за вывод брутто-суммы указанным методом (минорные единицы). */
export function computeWithdrawalFee(gross: bigint, method: WithdrawalMethod): bigint {
  const pctFee = BigInt(Math.floor(Number(gross) * method.feePct));
  return pctFee > method.minFee ? pctFee : method.minFee;
}
