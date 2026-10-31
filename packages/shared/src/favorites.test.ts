import { describe, expect, it } from 'vitest';
import { favoriteDrop, favoriteMatches, pickFavorites, type FavoriteItem } from './favorites';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW - days * DAY).toISOString();
const lot = (id: string, over: Partial<FavoriteItem> = {}) => ({
  id,
  price: '100000',
  status: 'active',
  addedAt: at(1),
  ...over,
});

describe('насколько подешевел лот', () => {
  it('с добавления, по скидке и «минимум за 30 дней» — что больше', () => {
    expect(favoriteDrop(lot('a', { wasPrice: '125000' }), NOW)).toBe(20);
    expect(
      favoriteDrop(
        lot('b', { saleListPrice: '200000', saleRefPrice: '150000', saleUntil: at(-1) }),
        NOW,
      ),
    ).toBe(33);
    expect(favoriteDrop(lot('c', { priceLowUntil: at(-10), priceDropPct: 12 }), NOW)).toBe(12);
    expect(
      favoriteDrop(lot('d', { wasPrice: '110000', priceLowUntil: at(-10), priceDropPct: 12 }), NOW),
    ).toBe(12);
  });

  it('прошедшая скидка и прошедший минимум — не в счёт; закончился — не в счёт', () => {
    expect(favoriteDrop(lot('a', { saleListPrice: '200000', saleUntil: at(1) }), NOW)).toBeNull();
    expect(favoriteDrop(lot('b', { priceLowUntil: at(1), priceDropPct: 12 }), NOW)).toBeNull();
    expect(favoriteDrop(lot('c', { wasPrice: '200000', status: 'sold_out' }), NOW)).toBeNull();
    expect(favoriteDrop(lot('d'), NOW)).toBeNull();
  });
});

describe('список избранного', () => {
  const items = [
    lot('cheap', { price: '50000', addedAt: at(5) }),
    lot('drop', {
      price: '90000',
      wasPrice: '120000',
      addedAt: at(3),
      game: { slug: 'cs2', title: 'CS2' },
    }),
    lot('gone', { price: '10000', status: 'sold_out', addedAt: at(0.5) }),
    lot('dear', { price: '300000', addedAt: at(2), game: { slug: 'cs2', title: 'CS2' } }),
  ];
  const ids = (l: { id: string }[]) => l.map((x) => x.id);

  it('фильтры: в продаже, подешевели, закончились', () => {
    expect(items.filter((l) => favoriteMatches(l, 'active', NOW))).toHaveLength(3);
    expect(ids(items.filter((l) => favoriteMatches(l, 'cheaper', NOW)))).toEqual(['drop']);
    expect(ids(items.filter((l) => favoriteMatches(l, 'gone', NOW)))).toEqual(['gone']);
  });

  it('порядок: недавно добавленные; дешевле и дороже — закончившиеся в конце; сильнее подешевели', () => {
    const pick = (sort: 'added' | 'cheap' | 'dear' | 'drop', game?: string) =>
      ids(pickFavorites(items, { filter: 'all', sort, game }, NOW));
    expect(pick('added')).toEqual(['gone', 'dear', 'drop', 'cheap']);
    expect(pick('cheap')).toEqual(['cheap', 'drop', 'dear', 'gone']);
    expect(pick('dear')).toEqual(['dear', 'drop', 'cheap', 'gone']);
    expect(pick('drop')).toEqual(['drop', 'dear', 'cheap', 'gone']);
    expect(pick('cheap', 'cs2')).toEqual(['drop', 'dear']);
  });
});
