import { mskDay } from './statement';

/**
 * Статистика лотов продавца: просмотры по дням, в избранном, покупки,
 * конверсия и заработанное за период. Дни — по Москве, как в выписке.
 */

export const STATS_PERIODS = [7, 30, 90] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

const DAY_MS = 86_400_000;

/** Доля покупок от просмотров, в процентах с одним знаком; без просмотров — null. */
export function conversionPct(purchases: number, views: number): number | null {
  if (views <= 0) return null;
  return Math.round((purchases / views) * 1000) / 10;
}

/** Дни периода по Москве, от старого к новому; последний — сегодня. */
export function lastDays(n: number, now = new Date()): string[] {
  return Array.from({ length: n }, (_, i) =>
    mskDay(new Date(now.getTime() - (n - 1 - i) * DAY_MS)),
  );
}
