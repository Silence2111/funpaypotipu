import { describe, expect, it } from 'vitest';
import { isPriceLow, priceSummary } from './price-history';

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

describe('отметка «минимум за 30 дней»', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  it('пока срок не вышел; без скидки и не у пополнения', () => {
    const until = '2026-11-01T00:00:00Z';
    expect(isPriceLow({ priceLowUntil: until }, now)).toBe(true);
    expect(isPriceLow({ priceLowUntil: '2026-10-21T11:59:59Z' }, now)).toBe(false);
    expect(isPriceLow({ priceLowUntil: null }, now)).toBe(false);
    // У скидки своя пометка «−20%».
    expect(isPriceLow({ priceLowUntil: until, saleListPrice: '120000' }, now)).toBe(false);
    expect(isPriceLow({ priceLowUntil: until, topupMarkupBps: 500 }, now)).toBe(false);
  });
});
