/**
 * История цены лота — «как менялась цена за 30 дней» на странице лота.
 * Точки — уже в текущей пачке лота и без повторов подряд (так их отдаёт API).
 */

export const PRICE_HISTORY_DAYS = 30;

export interface PricePoint {
  /** С этого момента действует цена. */
  at: string;
  /** Минорные единицы. */
  price: string;
}

/**
 * Сводка: цена сейчас, минимум и максимум за период — с датой, когда они
 * впервые были, — и сколько раз цена менялась. Пусто — null.
 */
export function priceSummary(points: PricePoint[]) {
  if (!points.length) return null;
  let min = points[0]!;
  let max = points[0]!;
  for (const p of points) {
    if (BigInt(p.price) < BigInt(min.price)) min = p;
    if (BigInt(p.price) > BigInt(max.price)) max = p;
  }
  return { current: points[points.length - 1]!.price, min, max, changes: points.length - 1 };
}

/**
 * Отметка «минимум за 30 дней» у лота. Цена опустилась хотя бы на
 * PRICE_LOW_MIN_PCT ниже самой низкой за PRICE_LOW_DAYS дней — и 30 дней с
 * этого снижения она ниже любой цены лота за последние 30 дней. Ставит и
 * снимает триггер базы при смене цены (миграция price_low), здесь — только
 * показывать ли.
 */
export const PRICE_LOW_DAYS = 30;
export const PRICE_LOW_MIN_PCT = 5;

/**
 * Показывать ли отметку: срок не вышел, нет скидки — у неё своя пометка
 * «−20%», — и лот не пополнение: там цена «от» следует из наценки.
 */
export function isPriceLow(
  l: {
    priceLowUntil?: string | Date | null;
    saleListPrice?: string | bigint | null;
    topupMarkupBps?: number | null;
  },
  now: number,
): boolean {
  if (!l.priceLowUntil || l.saleListPrice != null || l.topupMarkupBps != null) return false;
  return new Date(l.priceLowUntil).getTime() > now;
}

/** Меньше предложений — разброс не показываем: по двум ценам он ничего не говорит. */
export const PRICE_STATS_MIN = 3;

/**
 * Разброс цен в разделе — подсказка продавцу у поля цены: сколько
 * предложений, самая низкая, медиана и «чаще всего» (от четверти до трёх
 * четвертей). Цены — в одной пачке. Мало предложений — null.
 */
export function priceStats(prices: bigint[]) {
  if (prices.length < PRICE_STATS_MIN) return null;
  const sorted = [...prices].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // Ближайший ранг: значение, ниже или равно которому — доля q цен.
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
  return {
    count: sorted.length,
    min: sorted[0]!.toString(),
    p25: at(0.25).toString(),
    median: at(0.5).toString(),
    p75: at(0.75).toString(),
  };
}

/** Где цена продавца среди остальных: среди низких, в обычном разбросе, выше большинства. */
export function pricePlace(
  price: bigint,
  stats: { p25: string; p75: string },
): 'low' | 'usual' | 'high' {
  if (price < BigInt(stats.p25)) return 'low';
  if (price > BigInt(stats.p75)) return 'high';
  return 'usual';
}
