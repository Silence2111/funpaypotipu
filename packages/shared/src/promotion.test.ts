import { describe, expect, it } from 'vitest';
import { bumpCooldownHours, promoCost, promoUntil } from './promotion';

describe('продвижение', () => {
  it('стоимость — сутки × дни', () => {
    expect(promoCost(9_900n, 3)).toBe(29_700n);
  });

  it('продление добавляется к оставшемуся сроку, а не сгорает', () => {
    const now = new Date('2026-10-13T12:00:00Z');
    const current = new Date('2026-10-14T12:00:00Z');
    expect(promoUntil(current, 1, now).toISOString()).toBe('2026-10-15T12:00:00.000Z');
  });

  it('истёкшее продвижение считается от сейчас', () => {
    const now = new Date('2026-10-13T12:00:00Z');
    expect(promoUntil(new Date('2026-10-01T00:00:00Z'), 7, now).toISOString()).toBe('2026-10-20T12:00:00.000Z');
  });
});

describe('бесплатное поднятие', () => {
  it('чем больше продаж, тем чаще: 4 ч, с 10 продаж — 2 ч, с 50 — 1 ч', () => {
    expect([0, 9, 10, 49, 50, 500].map(bumpCooldownHours)).toEqual([4, 4, 2, 2, 1, 1]);
  });
});
