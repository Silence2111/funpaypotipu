'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ImageIcon, X } from 'lucide-react';
import { PRICE_DROP_MIN_PCT } from '@gamemarket/shared/saved-search';
import {
  FAVORITE_FILTERS,
  FAVORITE_SORTS,
  favoriteMatches,
  isPriceLow,
  pickFavorites,
  saleOff,
  type FavoriteFilter,
  type FavoriteSort,
} from '@gamemarket/shared';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { replaceUrl, withQuery } from '@/lib/url';
import { formatListingPrice, formatPrice } from '@/lib/format';
import { CabinetNav } from '@/components/cabinet-nav';
import { SaleMark } from '@/components/sale-mark';
import { PriceLowMark } from '@/components/price-low-mark';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

interface FavListing {
  id: string;
  title: string;
  price: string;
  currency: string;
  images: string[];
  status?: string;
  topupMarkupBps?: number | null;
  unitName?: string | null;
  pricePerUnits?: number;
  /** Цена при добавлении в избранное, если сейчас дешевле. */
  wasPrice?: string | null;
  saleListPrice?: string | null;
  saleRefPrice?: string | null;
  saleUntil?: string | null;
  priceLowUntil?: string | null;
  priceLowRef?: string | null;
  priceDropPct?: number | null;
  addedAt: string;
  game?: { slug: string; title: string } | null;
}

const FILTER_LABEL: Record<FavoriteFilter, string> = {
  all: msg('Все'),
  active: msg('В продаже'),
  cheaper: msg('Подешевели'),
  gone: msg('Закончились'),
};
const SORT_LABEL: Record<FavoriteSort, string> = {
  added: msg('Недавно добавленные'),
  cheap: msg('Сначала дешевле'),
  dear: msg('Сначала дороже'),
  drop: msg('Сильнее подешевели'),
};

/**
 * Избранное: что подешевело, что ещё в продаже и что закончилось — фильтром
 * со счётчиками, по игре и в нужном порядке; убрать — прямо с карточки.
 * Фильтр, игра и порядок — в адресе страницы.
 */
function FavoritesInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useT();
  const [items, setItems] = useState<FavListing[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pick = <K extends string>(v: string | null, all: K[], fallback: K) =>
    all.includes(v as K) ? (v as K) : fallback;
  const [filter, setFilter] = useState<FavoriteFilter>(
    pick(params.get('f'), FAVORITE_FILTERS, 'all'),
  );
  const [sort, setSort] = useState<FavoriteSort>(pick(params.get('sort'), FAVORITE_SORTS, 'added'));
  const [game, setGame] = useState(params.get('game') ?? '');
  const now = Date.now();

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent('/cabinet/favorites')}`);
      return;
    }
    apiFetch<FavListing[]>('/favorites')
      .then(setItems)
      .catch((e) => {
        setItems([]);
        setErr(apiErrorMessage(e, t('Не удалось загрузить избранное.')));
      });
  }, [router, t]);

  function go(next: { f?: FavoriteFilter; sort?: FavoriteSort; game?: string }) {
    const f = next.f ?? filter;
    const s = next.sort ?? sort;
    const g = next.game ?? game;
    setFilter(f);
    setSort(s);
    setGame(g);
    replaceUrl(withQuery(pathname, { f: f !== 'all' && f, sort: s !== 'added' && s, game: g }));
  }

  async function remove(l: FavListing) {
    const before = items;
    setItems((list) => list?.filter((x) => x.id !== l.id) ?? null);
    setErr(null);
    try {
      await apiFetch(`/favorites/${l.id}`, { method: 'DELETE' });
    } catch (e) {
      setItems(before);
      setErr(apiErrorMessage(e, t('Не удалось убрать из избранного.')));
    }
  }

  const games = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of items ?? []) if (l.game) seen.set(l.game.slug, l.game.title);
    return [...seen].map(([slug, title]) => ({ slug, title })).sort((a, b) => a.title.localeCompare(b.title));
  }, [items]);
  const inGame = (items ?? []).filter((l) => !game || l.game?.slug === game);
  const count = (f: FavoriteFilter) => inGame.filter((l) => favoriteMatches(l, f, now)).length;
  const shown = pickFavorites(items ?? [], { filter, sort, game: game || undefined }, now);

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>{t('Избранное')}</h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t('Лот подешевеет хотя бы на {pct}% — придёт уведомление. Настройка — в группе «Поиски, избранное и подписки».', {
            pct: PRICE_DROP_MIN_PCT,
          })}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {err && <div className="alert error" role="alert">{err}</div>}

      {items === null ? (
        <div className="skeleton" style={{ height: 240 }} aria-busy="true" />
      ) : items.length === 0 ? (
        <div className="card flat row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span className="muted">{t('В избранном пока пусто. «В избранное» на странице лота — и за его ценой можно следить.')}</span>
          <Link href="/catalog" className="btn secondary">{t('В каталог')}</Link>
        </div>
      ) : (
        <>
          <div className="row fav-toolbar">
            <div className="row" role="group" aria-label={t('Показать')} style={{ gap: 8, flexWrap: 'wrap' }}>
              {FAVORITE_FILTERS.map((f) => (
                <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => go({ f })}>
                  {t(FILTER_LABEL[f])}
                  {count(f) > 0 && <span className="notif-group-count">{count(f)}</span>}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {games.length > 1 && (
                <select className="input fav-select" aria-label={t('Игра')} value={game} onChange={(e) => go({ game: e.target.value })}>
                  <option value="">{t('Все игры')}</option>
                  {games.map((g) => (
                    <option key={g.slug} value={g.slug}>{t.d(g.title)}</option>
                  ))}
                </select>
              )}
              <select className="input fav-select" aria-label={t('Порядок')} value={sort}
                onChange={(e) => go({ sort: e.target.value as FavoriteSort })}>
                {FAVORITE_SORTS.map((s) => (
                  <option key={s} value={s}>{t(SORT_LABEL[s])}</option>
                ))}
              </select>
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="card flat row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <span className="muted">{t('Под этот фильтр ничего не подходит.')}</span>
              <button type="button" className="btn secondary" onClick={() => go({ f: 'all', game: '' })}>
                {t('Показать всё')}
              </button>
            </div>
          ) : (
            <div className="grid cols-auto">
              {shown.map((l) => {
                const active = !l.status || l.status === 'active';
                const sale = l.saleUntil && Date.parse(l.saleUntil) > now
                  && saleOff(l.saleRefPrice ?? l.saleListPrice, l.price) !== null;
                const low = !sale && isPriceLow(l, now);
                return (
                  <div key={l.id} className={`card fav-card${active ? '' : ' gone'}`}>
                    <Link href={`/lot/${l.id}`} className="fav-link">
                      <div className="thumb">
                        {l.images?.[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.images[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                        ) : (
                          <ImageIcon size={22} strokeWidth={1.5} />
                        )}
                      </div>
                      <span className="fav-title">{l.title}</span>
                      {l.game && <span className="fav-game">{t.d(l.game.title)}</span>}
                      <span className="row fav-price">
                        <span className="price">{formatListingPrice(l, t)}</span>
                        {active && sale && (
                          <SaleMark listPrice={l.saleRefPrice ?? l.saleListPrice} price={l.price} currency={l.currency} t={t} />
                        )}
                        {active && low && <PriceLowMark l={l} t={t} />}
                        {active && !sale && !low && l.wasPrice && (
                          <span className="badge success">
                            {t('было {price}', { price: formatPrice(l.wasPrice, l.currency, t) })}
                          </span>
                        )}
                        {!active && (
                          <span className="badge">{l.status === 'sold_out' ? t('закончился') : t('снят с продажи')}</span>
                        )}
                      </span>
                    </Link>
                    <button type="button" className="fav-remove" onClick={() => void remove(l)}
                      aria-label={t('Убрать из избранного: {title}', { title: l.title })} title={t('Убрать из избранного')}>
                      <X size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function FavoritesPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <FavoritesInner />
    </Suspense>
  );
}
