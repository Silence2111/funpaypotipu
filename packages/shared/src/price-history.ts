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
