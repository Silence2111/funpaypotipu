import { describe, expect, it } from 'vitest';
import { conversionPct, lastDays } from './lot-stats';

describe('статистика лотов', () => {
  it('конверсия — доля покупок от просмотров с одним знаком; без просмотров — нет', () => {
    expect(conversionPct(3, 120)).toBe(2.5);
    expect(conversionPct(1, 3)).toBe(33.3);
    expect(conversionPct(0, 50)).toBe(0);
    expect(conversionPct(2, 0)).toBeNull();
  });

  it('дни периода по Москве: последний — сегодня, даже когда в UTC ещё вчера', () => {
    // 22:30 UTC 21 октября — в Москве уже 22-е.
    const now = new Date('2026-10-21T22:30:00Z');
    expect(lastDays(3, now)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    expect(lastDays(30, now)).toHaveLength(30);
  });
});
