import { isPriceLow } from './price-history';
import { saleOff } from './sale';

/**
 * «Избранное» в кабинете: что лот сейчас дешевле и как собрать список —
 * общий расчёт для сайта и тестов.
 */

/** Лот в избранном — столько, сколько нужно для фильтра и сортировки. */
export interface FavoriteItem {
  price: string;
  status?: string;
  /** Цена при добавлении в избранное — если сейчас дешевле. */
  wasPrice?: string | null;
  saleListPrice?: string | null;
  saleRefPrice?: string | null;
  saleUntil?: string | null;
  priceLowUntil?: string | null;
  priceDropPct?: number | null;
  topupMarkupBps?: number | null;
  /** Когда добавили в избранное. */
  addedAt: string;
  game?: { slug: string; title: string } | null;
}

export type FavoriteFilter = 'all' | 'active' | 'cheaper' | 'gone';
export type FavoriteSort = 'added' | 'cheap' | 'dear' | 'drop';
export const FAVORITE_FILTERS: FavoriteFilter[] = ['all', 'active', 'cheaper', 'gone'];
export const FAVORITE_SORTS: FavoriteSort[] = ['added', 'cheap', 'dear', 'drop'];

const pct = (was: string, now: string) => {
  const w = BigInt(was);
  const n = BigInt(now);
  return w > n && w > 0n ? Math.round(Number(((w - n) * 1000n) / w) / 10) : 0;
};

/**
 * На сколько процентов лот сейчас дешевле — с добавления в избранное, по
 * скидке продавца или «минимум за 30 дней», что больше; не дешевле — null.
 * Закончившийся и снятый лот купить нельзя — для них тоже null.
 */
export function favoriteDrop(l: FavoriteItem, now: number): number | null {
  if (l.status && l.status !== 'active') return null;
  const since = l.wasPrice ? pct(l.wasPrice, l.price) : 0;
  const sale =
    l.saleUntil && new Date(l.saleUntil).getTime() > now
      ? (saleOff(l.saleRefPrice ?? l.saleListPrice, l.price) ?? 0)
      : 0;
  const low = isPriceLow(l, now) ? (l.priceDropPct ?? 0) : 0;
  const best = Math.max(since, sale, low);
  return best > 0 ? best : null;
}

/** Попадает ли лот под фильтр: в продаже, подешевел или закончился (снят). */
export function favoriteMatches(l: FavoriteItem, filter: FavoriteFilter, now: number): boolean {
  const active = !l.status || l.status === 'active';
  if (filter === 'active') return active;
  if (filter === 'gone') return !active;
  if (filter === 'cheaper') return favoriteDrop(l, now) !== null;
  return true;
}

/**
 * Список по фильтру, игре и порядку. Недоступные к покупке — в конце при
 * любом порядке, кроме «недавно добавленные»: сначала то, что можно купить.
 */
export function pickFavorites<T extends FavoriteItem>(
  items: T[],
  opts: { filter: FavoriteFilter; sort: FavoriteSort; game?: string },
  now: number,
): T[] {
  const list = items.filter(
    (l) => favoriteMatches(l, opts.filter, now) && (!opts.game || l.game?.slug === opts.game),
  );
  const added = (l: T) => new Date(l.addedAt).getTime();
  const gone = (l: T) => (l.status && l.status !== 'active' ? 1 : 0);
  const price = (l: T) => Number(BigInt(l.price));
  const by: Record<FavoriteSort, (a: T, b: T) => number> = {
    added: (a, b) => added(b) - added(a),
    cheap: (a, b) => gone(a) - gone(b) || price(a) - price(b) || added(b) - added(a),
    dear: (a, b) => gone(a) - gone(b) || price(b) - price(a) || added(b) - added(a),
    drop: (a, b) =>
      gone(a) - gone(b) ||
      (favoriteDrop(b, now) ?? 0) - (favoriteDrop(a, now) ?? 0) ||
      added(b) - added(a),
  };
  return [...list].sort(by[opts.sort]);
}
