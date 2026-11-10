import { computeWithdrawalFee, type WithdrawalMethod } from './withdrawal';

/**
 * «Сколько вы получите» на странице «Продавать на GameMarket»: продажа и
 * вывод на карту или СБП — у нас и по опубликованным ставкам конкурентов.
 * Суммы — в копейках. Наша комиссия приходит из API (правила комиссии),
 * ставки конкурентов — здесь: одна функция для страницы и для сервера.
 */

/** Сегменты разделов — как в базе (`CategorySegment`). */
export type SellSegment = 'accounts' | 'currency' | 'items' | 'service' | 'key' | 'topup';

/** Что выходит у продавца с одной продажи. */
export interface SellOutcome {
  /** Доля комиссии с продавца: 0.1 — 10%. */
  feePct: number;
  /** Комиссия с продажи. */
  fee: bigint;
  /** Пришло на баланс после продажи. */
  payout: bigint;
  /** Плата за вывод всей суммы на карту или СБП. */
  withdrawFee: bigint;
  /** На руки после вывода. */
  net: bigint;
}

/**
 * Опубликованные ставки FunPay и Playerok — из их справки и прайсов,
 * сверены 26.09.2026 (`ПРОДУКТ/РАЗВЕДКА.md`). У FunPay ставка зависит от
 * раздела, в справке — «в среднем около 9%», во многих разделах от 3%;
 * в расчёте — средняя. Playerok: 10% на донат, пополнения, лицензии и
 * подписки, 20% на остальное; вывод — 6%, минимум 60 ₽.
 */
export const COMPETITOR_RATES = {
  funpay: {
    name: 'FunPay',
    feePct: (_segment: SellSegment) => 0.09,
    withdrawal: { feePct: 0.03, minFee: 3000n },
  },
  playerok: {
    name: 'Playerok',
    feePct: (segment: SellSegment) => (segment === 'key' || segment === 'topup' ? 0.1 : 0.2),
    withdrawal: { feePct: 0.06, minFee: 6000n },
  },
} as const;
export type Competitor = keyof typeof COMPETITOR_RATES;
/** Когда сверялись ставки конкурентов — страница называет дату. */
export const COMPETITOR_RATES_CHECKED = '2026-09-26';

/** Вывод всей суммы: плата не больше самой суммы — на руки не бывает меньше нуля. */
function withdraw(payout: bigint, w: { feePct: number; minFee: bigint }): bigint {
  if (payout <= 0n) return 0n;
  const fee = computeWithdrawalFee(payout, { feePct: w.feePct, minFee: w.minFee } as WithdrawalMethod);
  return fee > payout ? payout : fee;
}

/** Продажа и вывод по готовой комиссии — наша (из API) или конкурента. */
export function sellOutcome(price: bigint, feePct: number, fee: bigint, w: { feePct: number; minFee: bigint }): SellOutcome {
  const payout = price - fee;
  const withdrawFee = withdraw(payout, w);
  return { feePct, fee, payout, withdrawFee, net: payout - withdrawFee };
}

/** То же у конкурента по его опубликованным ставкам. Комиссия — с округлением вниз, как у нас. */
export function competitorOutcome(who: Competitor, price: bigint, segment: SellSegment): SellOutcome {
  const c = COMPETITOR_RATES[who];
  const pct = c.feePct(segment);
  const fee = BigInt(Math.floor(Number(price) * pct));
  return sellOutcome(price, pct, fee, c.withdrawal);
}
