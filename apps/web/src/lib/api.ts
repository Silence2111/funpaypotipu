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
  listingCount?: number;
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
  fulfillmentType?: string;
  /** Лот «на сумму покупателя»: наценка и границы суммы; price — цена минимума («от»). */
  topupMarkupBps?: number | null;
  topupMin?: string | null;
  topupMax?: string | null;
  /** Поштучно: цена price — за pricePerUnits единиц; null — лот продаётся целиком. */
  unitName?: string | null;
  pricePerUnits?: number;
  minQty?: number;
  /** Наличие; null — без ограничения. У лота ключей — число ключей на складе. */
  stock?: number | null;
  seller: { profile: { username: string; ratingAvg: number; onlineAt?: string | null } | null };
  category: { slug: string; title: string };
  game: { slug: string; title: string };
}

export type ListingDetail = ListingCard & {
  description: string;
  attributes: Record<string, unknown>;
  /** Что продавец спрашивает у покупателя при покупке. */
  buyerFields?: Array<{ label: string; required: boolean }> | null;
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

/** Все игры с разделами и числом лотов — для указателя А–Я. */
export interface GameIndexEntry {
  id: string;
  slug: string;
  title: string;
  categories: Array<{ id: string; slug: string; title: string; listingCount: number }>;
}
export const getGameIndex = () => apiTry<GameIndexEntry[]>('/catalog/index');

export interface SellerProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  country: string | null;
  ratingAvg: number;
  ratingCount: number;
  salesCount: number;
  activeListings: number;
  memberSince: string;
  onlineAt: string | null;
  online: boolean;
  verified: boolean;
  level: { key: string; label: string };
  ratingBreakdown: { star: number; count: number }[];
}

export const getSeller = (id: string) => apiTry<SellerProfile>(`/sellers/${id}`);

export interface SellerDashboard {
  salesCount: number;
  revenueTotal: string;
  sales30: number;
  revenue30: string;
  activeListings: number;
  inProgress: number;
  ratingAvg: number;
  ratingCount: number;
  level: { key: string; label: string };
  revenueSeries: number[];
}

export interface Attribute {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  isFilter: boolean;
  isRequired: boolean;
  sortOrder: number;
}

export const getCategoryAttributes = (categoryId: string) =>
  apiTry<Attribute[]>(`/catalog/categories/${categoryId}/attributes`);

export function browseListings(params: {
  gameSlug?: string;
  categorySlug?: string;
  sellerId?: string;
  q?: string;
  sort?: string;
  attrs?: string;
  instant?: boolean;
  /** Только продавцы онлайн (последние 5 минут). */
  online?: boolean;
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

/**
 * Публичный прайс площадки.
 *
 * Цифры на витрине берутся из тех же правил, по которым считается реальная
 * сделка. Иначе комиссия на лендинге и комиссия в кошельке разъезжаются
 * при первой же правке в админке, и покупатель узнаёт об этом после оплаты.
 */
export interface PublicPricing {
  currency: string;
  sellerFeeMinPct: number;
  sellerFeeMaxPct: number;
  levelDiscountMaxPp: number;
  cashbackPct: number;
  /** Часов на проверку после выдачи, потом заказ подтверждается сам. */
  autoConfirmHours?: number;
  /** Часов у продавца на ручную выдачу, потом деньги возвращаются сами. */
  fulfillHours?: number;
  /** Платёжка — заглушка: оплата на стенде демонстрационная. */
  paymentsDemo?: boolean;
  withdrawal: Array<{ key: string; label: string; feePct: number; minFeeMinor: string }>;
}

export const getPublicPricing = () => apiTry<PublicPricing>('/fees/public');

/** Предложение «на сумму покупателя» для виджета пополнения (деньги — строкой). */
export interface TopupOffer {
  listingId: string;
  title: string;
  currency: string;
  markupBps: number;
  min: string;
  max: string;
  seller: { username: string | null };
}

export interface TopupOffers {
  game: { slug: string; title: string };
  currency: string;
  offers: TopupOffer[];
}

export const getTopupOffers = (game: string) =>
  apiTry<TopupOffers>(`/topup/offers?game=${encodeURIComponent(game)}`);

/**
 * Замер выдачи против тривиального правила. Печатается на витрине как есть,
 * включая «замер невозможен»: обещать «надёжные лоты сверху» без замера нельзя.
 */
export interface RankingBenchmark {
  measured: boolean;
  reason: string;
  total: number;
  clean: number;
  problem: number;
  results: Record<string, { share: number; pairs: number }>;
  caveats: string[];
  verdict: string;
  thresholds: { talk: number; claim: number };
}

export const getRankingBenchmark = () => apiTry<RankingBenchmark>('/ranking/benchmark');
