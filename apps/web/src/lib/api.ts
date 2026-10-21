import type { ReplyTime } from '@gamemarket/shared';
import { msg } from './i18n/lang';

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
  /** Сколько продавцов торгует в разделе и сколько из них в сети. */
  sellers?: SellersNow;
  /** Общая пачка раздела валюты: «за 1 000 золота». */
  unitName?: string | null;
  pricePerUnits?: number | null;
}

export interface SellersNow {
  sellers: number;
  online: number;
}

export type GameWithCategories = Game & { categories: Category[]; sellers?: SellersNow };

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
  /** Платное продвижение до этого времени. */
  promotedUntil?: string | null;
  /** Скидка: прежняя цена и срок; price — уже со скидкой. */
  saleListPrice?: string | null;
  saleUntil?: string | null;
  /** Параметры раздела: звание, регион, сервер; «да/нет» — булевы. */
  attributes?: Record<string, unknown>;
  seller: { id?: string; profile: SellerBrief | null };
  category: { id?: string; slug: string; title: string };
  game: { slug: string; title: string };
}

/** Продавец в строке выдачи: кто продаёт, его репутация и в сети ли он. */
export interface SellerBrief {
  username: string;
  displayName?: string;
  avatarUrl?: string | null;
  ratingAvg: number;
  ratingCount?: number;
  onlineAt?: string | null;
}

export type ListingDetail = ListingCard & {
  description: string;
  attributes: Record<string, unknown>;
  /** Что продавец спрашивает у покупателя при покупке. */
  buyerFields?: Array<{ label: string; required: boolean }> | null;
  fulfillmentType: string;
  salesCount: number;
  /** Выдача раздела: автовыдача у аккаунтов — со склада строк, а не ключи. */
  category: { id: string; slug: string; title: string; fulfillmentType?: string };
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

/** Все игры с разделами и числом лотов — для указателя А–Я и поиска по играм. */
export interface GameIndexEntry {
  id: string;
  slug: string;
  title: string;
  /** game — игра, mobile — мобильная игра, app — приложение или сервис. */
  kind: 'game' | 'mobile' | 'app';
  /** Как игру ищут: «кс», «дота». */
  aliases: string[];
  /** Место в «Популярных»; 100 — не в них. */
  sortOrder: number;
  /** Продавцов игры в сети прямо сейчас. */
  onlineSellers?: number;
  categories: Array<{ id: string; slug: string; title: string; listingCount: number }>;
}

/** Типы товаров во всех играх — как строка категорий на главной Playerok. Подписи — через t(). */
export const SEGMENTS: Array<[string, string]> = [
  ['accounts', msg('Аккаунты')],
  ['currency', msg('Валюта')],
  ['items', msg('Предметы')],
  ['key', msg('Ключи')],
  ['topup', msg('Донат')],
  ['service', msg('Услуги')],
];

/** Подписи видов игр; показывать через t(). */
export const KIND_LABELS: Record<GameIndexEntry['kind'], string> = {
  game: msg('Игры'),
  mobile: msg('Мобильные игры'),
  app: msg('Приложения и сервисы'),
};
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
  /** В отпуске: лоты сняты до возвращения продавца. */
  away?: boolean;
  verified: boolean;
  level: { key: string; label: string };
  ratingBreakdown: { star: number; count: number }[];
  /** Отзывов с фото — для фильтра «С фото». */
  photoReviews?: number;
  /** За сколько обычно отвечает; null — живых ответов пока мало. */
  replyTime?: ReplyTime | null;
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

/** Сохранённый поиск покупателя: раздел, параметры, текст, «цена до». */
export interface SavedSearch {
  id: string;
  categoryId: string;
  game: { slug: string; title: string } | null;
  category: { slug: string; title: string };
  /** Подписи параметров раздела: rank → «Звание». */
  labels: Record<string, string>;
  attrs: Record<string, string | boolean>;
  q: string | null;
  /** Копейки строкой; null — без предела. */
  maxPrice: string | null;
  notify: boolean;
  createdAt: string;
  lastHitAt: string | null;
  /** Раздел с этими условиями. */
  path: string | null;
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
  /** Тип товара во всех играх: accounts, currency, items, key, topup, service. */
  segment?: string;
  instant?: boolean;
  /** Только продавцы онлайн (последние 5 минут). */
  online?: boolean;
  /** «Цена до», в копейках — из сохранённого поиска. */
  maxPrice?: number;
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
  /** Способы оплаты, которые принимает шлюз. */
  payMethods?: string[];
  /** Цена суток продвижения лота, копейки. */
  promoDayPrice?: string;
  /** Часов на проверку после автоматической выдачи: ключ, пополнение, товар со склада. */
  autoGoodsConfirmHours?: number;
  /** Вывод свыше этой суммы (копейки) — после верификации личности. */
  payoutKycAboveMinor?: string;
  /** Дней ждёт первый вывод у пользователя без продаж. */
  payoutNewbieHoldDays?: number;
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
