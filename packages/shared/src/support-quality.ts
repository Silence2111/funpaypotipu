/**
 * Поддержка (часть 138): срок ответа и эскалация, оценка ответа, «обычно
 * отвечаем за …» по живым данным.
 *
 * Без zod и без Node: модуль идёт и в браузер.
 */

/** Ждёт ответа поддержки дольше стольких часов — эскалация старшим. */
export const SUPPORT_SLA_HOURS = 8;
/** По какому окну считаем время ответа. */
export const SUPPORT_STATS_DAYS = 30;

/** Медиана, секунды; пусто — null. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}
