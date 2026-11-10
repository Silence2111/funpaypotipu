'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { BuyRequestState, MyBuyRequest, SellerBuyRequest } from '@/lib/api';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice, mskDate } from '@/lib/format';
import { CabinetNav } from '@/components/cabinet-nav';
import { OfferLot } from '@/components/buy-requests';
import { useT } from '@/lib/i18n/client';
import { msg, type T } from '@/lib/i18n/lang';

type SellerList = {
  scope: 'mine' | 'all';
  sellingIn: number;
  total: number;
  items: SellerBuyRequest[];
};

const STATE: Record<BuyRequestState, { label: string; tone: string }> = {
  open: { label: msg('Открыт'), tone: 'success' },
  expired: { label: msg('Истёк'), tone: '' },
  closed: { label: msg('Закрыт'), tone: '' },
  removed: { label: msg('Снят модератором'), tone: 'danger' },
};

const sectionHref = (r: { game: { slug: string } | null; category: { slug: string } }) =>
  r.game ? `/igra/${r.game.slug}/${r.category.slug}` : null;
const where = (r: { game: { title: string } | null; category: { title: string } }, t: T) =>
  `${r.game ? `${t.d(r.game.title)} · ` : ''}${t.d(r.category.title)}`;

/**
 * «Запросы»: продавцу — что ищут покупатели в его разделах (или во всех,
 * пока лотов нет), с «Предложить лот»; покупателю — его запросы и лоты,
 * которыми ответили продавцы.
 */
function RequestsPage() {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const tab = sp.get('tab') === 'mine' ? 'mine' : 'sellers';
  const highlight = sp.get('r');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [seller, setSeller] = useState<SellerList | null>(null);
  const [mine, setMine] = useState<MyBuyRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const loadSeller = useCallback(
    async (s: 'mine' | 'all') => {
      const q = new URLSearchParams({ scope: s });
      if (highlight) q.set('r', highlight);
      const list = await apiFetch<SellerList>(`/buy-requests/for-seller?${q}`);
      // Лотов в продаже нет — «в моих разделах» пусто всегда: сразу все разделы.
      if (s === 'mine' && list.sellingIn === 0) {
        setScope('all');
        return;
      }
      setSeller(list);
    },
    [highlight],
  );

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    setNote(null);
    if (tab === 'mine') {
      apiFetch<MyBuyRequest[]>('/buy-requests/mine')
        .then(setMine)
        .catch(() => setNote({ ok: false, text: t('Не удалось загрузить запросы.') }));
    } else {
      setSeller(null);
      loadSeller(scope).catch(() =>
        setNote({ ok: false, text: t('Не удалось загрузить запросы.') }),
      );
    }
  }, [tab, scope, router, t, loadSeller]);

  async function close(r: MyBuyRequest) {
    setBusy(r.id);
    setNote(null);
    try {
      const next = await apiFetch<MyBuyRequest>(`/buy-requests/${r.id}/close`, { method: 'POST' });
      setMine((l) => l?.map((x) => (x.id === next.id ? next : x)) ?? null);
      setNote({ ok: true, text: t('Запрос закрыт — продавцы его больше не видят.') });
    } catch (e) {
      setNote({ ok: false, text: apiErrorMessage(e, t('Не удалось закрыть запрос.')) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Запросы')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '62ch' }}>
          {t(
            'Покупатели пишут в разделе, что ищут и до какой цены. Продавцам раздела приходит уведомление, они отвечают своими лотами.',
          )}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {/* Вкладки и содержимое — одним блоком: отступ между ними свой, не 40 px страницы. */}
      <div style={{ display: 'grid', gap: 16 }}>
        <nav className="tabs" aria-label={t('Запросы')}>
          <Link
            href="/cabinet/requests"
            className="tab"
            aria-current={tab === 'sellers' ? 'page' : undefined}
          >
            {t('Покупатели ищут')}
          </Link>
          <Link
            href="/cabinet/requests?tab=mine"
            className="tab"
            aria-current={tab === 'mine' ? 'page' : undefined}
          >
            {t('Мои запросы')}
          </Link>
        </nav>

        {note && (
          <div
            className={note.ok ? 'alert success' : 'alert error'}
            role={note.ok ? 'status' : 'alert'}
          >
            {note.text}
          </div>
        )}

        {tab === 'sellers' ? (
          <>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="chip"
                aria-pressed={scope === 'mine'}
                onClick={() => setScope('mine')}
              // Лотов в продаже нет — «мои разделы» пусты: выбирать нечего.
              disabled={seller?.sellingIn === 0}
              >
                {t('В моих разделах')}
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={scope === 'all'}
                onClick={() => setScope('all')}
              >
                {t('Во всех разделах')}
              </button>
            </div>
            {seller?.scope === 'all' && seller.sellingIn === 0 && (
              <p className="hint">
                {t('У вас пока нет лотов в продаже — показываем запросы всех разделов.')}
              </p>
            )}
            {seller === null ? (
              <div className="skeleton" style={{ height: 200 }} aria-busy="true" />
            ) : seller.items.length === 0 ? (
              <div className="card flat empty-state">
                <p className="muted" style={{ maxWidth: '60ch' }}>
                  {seller.scope === 'mine'
                    ? t('В ваших разделах открытых запросов нет. Новый придёт уведомлением.')
                    : t('Открытых запросов пока нет.')}
                </p>
              </div>
            ) : (
              <ul className="requests">
                {seller.items.map((r) => (
                  <li
                    key={r.id}
                    className="card request-item"
                    style={r.id === highlight ? { borderColor: 'var(--accent)' } : undefined}
                  >
                    <div className="request-meta">
                      {sectionHref(r) ? (
                        <Link href={sectionHref(r)!}>{where(r, t)}</Link>
                      ) : (
                        <span>{where(r, t)}</span>
                      )}
                    </div>
                    <div className="request-head">
                      <span className="request-text">{r.text}</span>
                      {r.maxPrice && (
                        <span className="request-budget">
                          {t('до {price}', { price: formatPrice(r.maxPrice, 'RUB', t) })}
                        </span>
                      )}
                    </div>
                    <div className="request-meta">
                      {r.buyer && <span>{r.buyer}</span>}
                      <span>
                        {t('{date}, открыт до {until}', {
                          date: mskDate(r.createdAt, t),
                          until: mskDate(r.expiresAt, t),
                        })}
                      </span>
                      {r.offers > 0 && <span>{t('Предложено лотов: {n}', { n: r.offers })}</span>}
                    </div>
                    <div className="request-actions">
                      <OfferLot
                        requestId={r.id}
                        buyerId={null}
                        offered={r.myOffers.length}
                        sellHref={
                          r.game
                            ? `/cabinet/new?game=${encodeURIComponent(r.game.slug)}&category=${encodeURIComponent(r.category.slug)}`
                            : '/cabinet/new?'
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : mine === null ? (
          <div className="skeleton" style={{ height: 200 }} aria-busy="true" />
        ) : mine.length === 0 ? (
          <div className="card flat empty-state">
            <p className="muted" style={{ maxWidth: '60ch' }}>
              {t(
                'Запросов нет. Не нашли нужное? Откройте раздел игры и нажмите «Оставить запрос» — продавцы предложат свои лоты.',
              )}
            </p>
            <Link href="/igry" className="btn secondary">
              {t('Все игры')}
            </Link>
          </div>
        ) : (
          <ul className="requests">
            {mine.map((r) => (
              <li key={r.id} className="card request-item">
                <div className="request-meta">
                  {sectionHref(r) ? (
                    <Link href={sectionHref(r)!}>{where(r, t)}</Link>
                  ) : (
                    <span>{where(r, t)}</span>
                  )}
                  <span className={`badge ${STATE[r.state].tone}`}>{t(STATE[r.state].label)}</span>
                </div>
                <div className="request-head">
                  <span className="request-text">{r.text}</span>
                  {r.maxPrice && (
                    <span className="request-budget">
                      {t('до {price}', { price: formatPrice(r.maxPrice, 'RUB', t) })}
                    </span>
                  )}
                </div>
                <div className="request-meta">
                  <span>
                    {r.state === 'open'
                      ? t('{date}, открыт до {until}', {
                          date: mskDate(r.createdAt, t),
                          until: mskDate(r.expiresAt, t),
                        })
                      : mskDate(r.createdAt, t)}
                  </span>
                  <span>{t('Уведомление ушло продавцам: {n}', { n: r.notified })}</span>
                </div>
                {r.offers.length > 0 ? (
                  <ul className="request-offers" aria-label={t('Ответы продавцов')}>
                    {r.offers.map((o) => (
                      <li key={o.listing.id}>
                        <Link href={`/lot/${o.listing.id}`}>{o.listing.title}</Link>
                        <span className="request-lot-price">
                          {formatPrice(o.listing.price, o.listing.currency, t)}
                        </span>
                        {o.listing.seller && (
                          <span className="faint">
                            {o.listing.seller.ratingCount
                              ? t('{name} · ★ {rating}', {
                                  name: o.listing.seller.username,
                                  rating: o.listing.seller.ratingAvg.toFixed(1),
                                })
                              : o.listing.seller.username}
                          </span>
                        )}
                        {!o.listing.active ? (
                          <span className="badge">{t('Снят с продажи')}</span>
                        ) : (
                          !o.listing.withinBudget && (
                            <span className="badge warning">{t('Дороже вашей цены')}</span>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  r.state === 'open' && (
                    <p className="hint">
                      {t('Продавцы ещё не ответили — ответ придёт уведомлением.')}
                    </p>
                  )
                )}
                {r.state === 'open' && (
                  <div className="request-actions">
                    <button
                      type="button"
                      className="chip"
                      disabled={busy === r.id}
                      onClick={() => void close(r)}
                    >
                      {t('Закрыть запрос')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RequestsPage />
    </Suspense>
  );
}
