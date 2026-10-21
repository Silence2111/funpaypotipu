/**
 * Сохранённые поиски покупателя: фильтры раздела и «цена до». Новые лоты,
 * выставленные после сохранения, приходят уведомлением — каждый один раз.
 * Подбирает их тот же запрос, что показывает раздел: что пришло в
 * уведомлении, то и видно по ссылке из него.
 */

export const MAX_SAVED_SEARCHES = 20;

/**
 * Лот из избранного подешевел — уведомление, если цена за единицу упала
 * хотя бы на столько процентов от последней известной. Меньше — это
 * «минус рубль» в ценовой войне продавцов, а не повод писать покупателю.
 */
export const PRICE_DROP_MIN_PCT = 5;
/** Параметров в поиске — не больше, чем бывает фильтров у раздела. */
export const MAX_SEARCH_ATTRS = 10;

/** Параметры раздела, как ?f_ в адресе: {"rank":"Global Elite","prime":true}. */
export type SearchAttrs = Record<string, string | boolean>;

export interface SearchFilters {
  categoryId: string;
  attrs: SearchAttrs;
  q: string | null;
  /** Минорные единицы строкой, как деньги в ответах API; null — без предела. */
  maxPrice: string | null;
}

/**
 * Параметры из запроса или базы: ключ — слаг параметра, значение — вариант
 * списка или «да». «Нет» не фильтр, пустое — тоже.
 */
export function searchAttrs(raw: unknown): SearchAttrs {
  const out: SearchAttrs = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_SEARCH_ATTRS) break;
    if (!/^[a-z0-9_]{1,40}$/i.test(k)) continue;
    if (v === true) out[k] = true;
    else if (typeof v === 'string' && v.trim() && v.length <= 100) out[k] = v.trim();
  }
  return out;
}

/** Те же условия: порядок параметров и регистр текста не важны. */
export function sameSearch(a: SearchFilters, b: SearchFilters): boolean {
  const keys = (x: SearchAttrs) => Object.keys(x).sort();
  const ka = keys(a.attrs);
  const kb = keys(b.attrs);
  return (
    a.categoryId === b.categoryId &&
    (a.q ?? '').trim().toLowerCase() === (b.q ?? '').trim().toLowerCase() &&
    (a.maxPrice ?? null) === (b.maxPrice ?? null) &&
    ka.length === kb.length &&
    ka.every((k, i) => k === kb[i] && a.attrs[k] === b.attrs[k])
  );
}

/**
 * Адрес раздела с этими условиями — ссылка из уведомления и из «Моих
 * поисков». Цена — в рублях, параметр max понимает страница раздела.
 */
export function searchPath(
  gameSlug: string,
  categorySlug: string,
  f: Pick<SearchFilters, 'attrs' | 'q' | 'maxPrice'>,
): string {
  const p: string[] = [];
  const add = (k: string, v: string) => p.push(`${k}=${encodeURIComponent(v)}`);
  for (const k of Object.keys(f.attrs).sort()) {
    const v = f.attrs[k];
    add(`f_${k}`, v === true ? '1' : String(v));
  }
  if (f.q?.trim()) add('q', f.q.trim());
  if (f.maxPrice) add('max', String(Math.floor(Number(f.maxPrice) / 100)));
  const s = p.join('&');
  const base = `/igra/${encodeURIComponent(gameSlug)}/${encodeURIComponent(categorySlug)}`;
  return s ? `${base}?${s}` : base;
}
