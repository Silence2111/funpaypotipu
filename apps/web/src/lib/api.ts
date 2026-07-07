// SSR внутри контейнера ходит на внутренний адрес (api:4000), браузер — на публичный.
const API_URL =
  process.env.API_URL_INTERNAL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Тонкий клиент к API. На сервере (RSC) и клиенте используется одинаково. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

/** Безопасный вариант: null вместо исключения (для graceful degradation в SSR). */
export async function apiTry<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch {
    return null;
  }
}

// ── Типы ответов ──
export interface Game {
  id: string;
  slug: string;
  title: string;
  iconUrl: string | null;
  coverUrl: string | null;
}

export interface Category {
  id: string;
  slug: string;
  title: string;
  segment: string;
  fulfillmentType: string;
}

export type GameWithCategories = Game & { categories: Category[] };

export interface ListingCard {
  id: string;
  title: string;
  price: string; // минорные единицы строкой
  currency: string;
  images: string[];
  status: string;
  createdAt: string;
  seller: { profile: { username: string; ratingAvg: number } | null };
  category: { slug: string; title: string };
  game: { slug: string; title: string };
}

export type ListingDetail = ListingCard & {
  description: string;
  attributes: Record<string, unknown>;
  fulfillmentType: string;
  salesCount: number;
  seller: { id: string; profile: { username: string; ratingAvg: number; ratingCount: number } | null };
};

export interface BrowseResult {
  items: ListingCard[];
  total: number;
  page: number;
  limit: number;
}

// ── Фетчеры ──
export const getGames = () => apiTry<Game[]>('/catalog/games');
export const getGame = (slug: string) => apiTry<GameWithCategories>(`/catalog/games/${slug}`);
export const getListing = (id: string) => apiTry<ListingDetail>(`/listings/${id}`);

export function browseListings(params: {
  gameSlug?: string;
  categorySlug?: string;
  q?: string;
  sort?: string;
  limit?: number;
  page?: number;
}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return apiTry<BrowseResult>(`/listings${s ? `?${s}` : ''}`);
}
