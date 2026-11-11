/**
 * Защита продавца (часть 136): кому продавать. Продавец сам задаёт фильтр
 * покупателей — возраст аккаунта, проигранные споры, оценки других
 * продавцов; покупатель видит условия на странице лота до заказа.
 * Площадка ограничивает и споры: не больше трёх открытых сразу.
 *
 * Без zod и без Node: модуль идёт и в браузер.
 */

export interface BuyerFilter {
  /** Аккаунт покупателя не моложе стольких дней; 0 — любой. */
  minAgeDays: number;
  /** Проигранных споров за 90 дней не больше; null — не важно. */
  maxLostDisputes: number | null;
  /** «Не рекомендую» от продавцов не больше, чем «рекомендую». */
  noBadReviews: boolean;
}

export const BUYER_FILTER_OFF: BuyerFilter = { minAgeDays: 0, maxLostDisputes: null, noBadReviews: false };
export const BUYER_AGE_DAYS = [0, 1, 7, 30] as const;
export const BUYER_LOST_DISPUTES = [0, 1, 3] as const;
/** Сколько споров покупатель может держать открытыми сразу. */
export const BUYER_OPEN_DISPUTES_MAX = 3;
/** За какой срок считаем проигранные споры. */
export const BUYER_DISPUTES_DAYS = 90;

export function buyerFilterOf(saved: unknown): BuyerFilter {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof BuyerFilter, unknown>>;
  return {
    minAgeDays: (BUYER_AGE_DAYS as readonly number[]).includes(s.minAgeDays as number) ? (s.minAgeDays as number) : 0,
    maxLostDisputes: (BUYER_LOST_DISPUTES as readonly number[]).includes(s.maxLostDisputes as number) ? (s.maxLostDisputes as number) : null,
    noBadReviews: s.noBadReviews === true,
  };
}

export const buyerFilterActive = (f: BuyerFilter) => f.minAgeDays > 0 || f.maxLostDisputes !== null || f.noBadReviews;

export interface BuyerStats {
  ageDays: number;
  lostDisputes: number;
  goodReviews: number;
  badReviews: number;
}

/** Что из условий продавца покупатель не проходит — первое по порядку, или null. */
export function buyerFilterMiss(f: BuyerFilter, s: BuyerStats): 'age' | 'disputes' | 'reviews' | null {
  if (f.minAgeDays > 0 && s.ageDays < f.minAgeDays) return 'age';
  if (f.maxLostDisputes !== null && s.lostDisputes > f.maxLostDisputes) return 'disputes';
  if (f.noBadReviews && s.badReviews > 0 && s.badReviews >= s.goodReviews) return 'reviews';
  return null;
}
