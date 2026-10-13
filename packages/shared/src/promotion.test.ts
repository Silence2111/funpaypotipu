import { describe, expect, it } from 'vitest';
import { promoCost, promoUntil } from './promotion';

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
