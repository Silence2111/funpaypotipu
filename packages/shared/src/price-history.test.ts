import { describe, expect, it } from 'vitest';
import { priceSummary } from './price-history';

describe('история цены', () => {
  it('сейчас, минимум и максимум с датой, число изменений', () => {
    const points = [
      { at: '2026-10-01T00:00:00Z', price: '120000' },
      { at: '2026-10-05T00:00:00Z', price: '90000' },
      { at: '2026-10-09T00:00:00Z', price: '150000' },
      { at: '2026-10-12T00:00:00Z', price: '90000' },
      { at: '2026-10-15T00:00:00Z', price: '110000' },
    ];
    expect(priceSummary(points)).toEqual({
      current: '110000',
      min: points[1],
      max: points[2],
      changes: 4,
    });
  });

  it('цена не менялась — одна точка; пусто — null', () => {
    expect(priceSummary([{ at: '2026-10-01T00:00:00Z', price: '5000' }])).toMatchObject({
      current: '5000',
      changes: 0,
    });
    expect(priceSummary([])).toBeNull();
  });
});
