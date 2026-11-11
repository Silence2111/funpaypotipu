import { describe, expect, it } from 'vitest';
import { BUYER_FILTER_OFF, buyerFilterActive, buyerFilterMiss, buyerFilterOf } from './buyer-filter';

describe('фильтр покупателей продавца', () => {
  it('сохранённое — только из вариантов, иначе выключено', () => {
    expect(buyerFilterOf(null)).toEqual(BUYER_FILTER_OFF);
    expect(buyerFilterOf({ minAgeDays: 7, maxLostDisputes: 1, noBadReviews: true })).toEqual({ minAgeDays: 7, maxLostDisputes: 1, noBadReviews: true });
    expect(buyerFilterOf({ minAgeDays: 5, maxLostDisputes: 2 })).toEqual(BUYER_FILTER_OFF);
    expect(buyerFilterActive(BUYER_FILTER_OFF)).toBe(false);
  });

  it('покупатель не проходит: молодой аккаунт, проигранные споры, плохие оценки', () => {
    const f = { minAgeDays: 7, maxLostDisputes: 0, noBadReviews: true };
    const ok = { ageDays: 30, lostDisputes: 0, goodReviews: 3, badReviews: 1 };
    expect(buyerFilterMiss(f, ok)).toBeNull();
    expect(buyerFilterMiss(f, { ...ok, ageDays: 2 })).toBe('age');
    expect(buyerFilterMiss(f, { ...ok, lostDisputes: 1 })).toBe('disputes');
    expect(buyerFilterMiss(f, { ...ok, goodReviews: 1, badReviews: 1 })).toBe('reviews');
    expect(buyerFilterMiss(BUYER_FILTER_OFF, { ageDays: 0, lostDisputes: 9, goodReviews: 0, badReviews: 9 })).toBeNull();
  });
});
