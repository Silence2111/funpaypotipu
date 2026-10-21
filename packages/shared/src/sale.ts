/**
 * Временная скидка на лот. На время скидки цена лота — сниженная, прежняя
 * хранится отдельно: оплата, сортировка, фильтры, сохранённые поиски и
 * уведомление о снижении цены в избранном работают с ценой, которую
 * покупатель платит. Срок вышел — прежняя цена возвращается сама.
 */

export const SALE_MIN_PCT = 5;
export const SALE_MAX_PCT = 90;
/** Сроки на выбор в «Моих лотах»; API принимает до SALE_MAX_DAYS. */
export const SALE_DAYS = [1, 3, 7] as const;
export const SALE_MAX_DAYS = 14;
/** Дешевле рубля лот не продаётся и со скидкой. */
export const SALE_MIN_PRICE = 100n;

/** Цена со скидкой, в копейках: округляется до копейки вниз — в пользу покупателя. */
export function salePrice(listPrice: bigint, pct: number): bigint {
  return (listPrice * BigInt(100 - pct)) / 100n;
}

/**
 * Скидка в процентах для пометки «−20%»: от прежней цены, целым числом.
 * Нет прежней цены или она не выше нынешней — скидки нет.
 */
export function saleOff(
  listPrice: string | bigint | null | undefined,
  price: string | bigint,
): number | null {
  if (listPrice == null) return null;
  const list = BigInt(listPrice);
  const now = BigInt(price);
  if (list <= 0n || now >= list) return null;
  return Math.round(Number(((list - now) * 1000n) / list) / 10);
}
