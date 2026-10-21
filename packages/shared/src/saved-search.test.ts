import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_ATTRS, sameSearch, searchAttrs, searchPath } from './saved-search';
import { notifyGroupOf, notifyLink } from './notify';

const base = { categoryId: 'c1', attrs: {}, q: null, maxPrice: null };

describe('параметры поиска', () => {
  it('только слаги, варианты списка и «да»; не больше предела', () => {
    expect(
      searchAttrs({ rank: ' Global Elite ', prime: true, vac: false, 'bad key': 'x', empty: '' }),
    ).toEqual({ rank: 'Global Elite', prime: true });
    expect(searchAttrs(null)).toEqual({});
    expect(searchAttrs(['rank'])).toEqual({});
    const many = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, 'v']));
    expect(Object.keys(searchAttrs(many))).toHaveLength(MAX_SEARCH_ATTRS);
  });
});

describe('тот же поиск', () => {
  it('порядок параметров и регистр текста не важны, цена и раздел — важны', () => {
    const a = { ...base, attrs: { rank: 'Gold', prime: true }, q: 'Prime' };
    expect(sameSearch(a, { ...base, attrs: { prime: true, rank: 'Gold' }, q: ' prime ' })).toBe(
      true,
    );
    expect(sameSearch(a, { ...a, maxPrice: '150000' })).toBe(false);
    expect(sameSearch(a, { ...a, categoryId: 'c2' })).toBe(false);
    expect(sameSearch(a, { ...a, attrs: { rank: 'Gold' } })).toBe(false);
    expect(sameSearch(base, { ...base, q: '' })).toBe(true);
  });
});

describe('адрес раздела', () => {
  it('параметры f_, текст и цена в рублях — как понимает страница раздела', () => {
    expect(
      searchPath('cs2', 'accounts', {
        attrs: { rank: 'Global Elite', prime: true },
        q: 'нож',
        maxPrice: '150000',
      }),
    ).toBe('/igra/cs2/accounts?f_prime=1&f_rank=Global%20Elite&q=%D0%BD%D0%BE%D0%B6&max=1500');
    expect(searchPath('cs2', 'accounts', { attrs: {}, q: null, maxPrice: null })).toBe(
      '/igra/cs2/accounts',
    );
  });

  it('уведомление ведёт на лот, если он один, иначе — в раздел с условиями', () => {
    expect(notifyGroupOf('saved_search')).toBe('searches');
    expect(notifyLink('saved_search', { listingId: 'l1', path: '/igra/cs2/accounts' })).toBe(
      '/lot/l1',
    );
    expect(notifyLink('saved_search', { path: '/igra/cs2/accounts?max=1500' })).toBe(
      '/igra/cs2/accounts?max=1500',
    );
    expect(notifyLink('saved_search', { path: 'https://evil.example' })).toBe('/cabinet/searches');
  });
});
