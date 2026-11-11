'use client';

import { useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { isCurrentQuery, isPlainClick, replaceUrl, withQuery } from '@/lib/url';
import { Empty, LISTING_STATUS, StatusBadge, USER_STATUS, when } from './shared';
import { useDecisionDialog } from './decision-dialog';
import { usePaged, type Paged } from './use-paged';

type Filter = '' | 'review' | 'active' | 'paused' | 'sold_out' | 'blocked' | 'archived';
type Counts = Record<'all' | Exclude<Filter, ''>, number>;

interface Row {
  id: string;
  title: string;
  status: string;
  price: string;
  currency: string;
  /** null — выдача вручную, без склада. */
  stock: number | null;
  createdAt: string;
  game: { title: string };
  category: { title: string };
  seller: { id: string; status: string; profile: { username: string } | null };
  /** У заблокированного — когда, кто и за что. */
  block: { at: string; by: string | null; reason: string | null } | null;
  /** На проверке: найденная фраза о передаче аккаунта и текст лота (часть 122). */
  reviewReason?: string | null;
  description?: string;
}
type Page = Paged<Row, Counts> & { seller: { id: string; username: string | null } | null };

const FILTERS: Array<{ key: Filter; count: keyof Counts; label: string }> = [
  { key: '', count: 'all', label: 'Все' },
  // Лоты со словами о передаче аккаунта: в каталог не выходят, пока не одобрят.
  { key: 'review', count: 'review', label: 'На проверке' },
  { key: 'active', count: 'active', label: 'В продаже' },
  { key: 'paused', count: 'paused', label: 'Сняты' },
  { key: 'sold_out', count: 'sold_out', label: 'Закончились' },
  { key: 'blocked', count: 'blocked', label: 'Заблокированы' },
  { key: 'archived', count: 'archived', label: 'В архиве' },
];
const readFilter = (v: string | null): Filter => FILTERS.find((f) => f.key === v)?.key ?? '';
/** Счётчик, в который попадает лот: черновики — вместе со снятыми, как в кабинете продавца. */
const countOf = (status: string): keyof Counts | null =>
  status === 'draft' ? 'paused' : FILTERS.some((f) => f.key === status) ? (status as keyof Counts) : null;
const fits = (l: Row, f: Filter) =>
  f === '' ? l.status !== 'archived' : f === 'paused' ? l.status === 'paused' || l.status === 'draft' : l.status === f;

interface Filters {
  status: Filter;
  seller: string;
  q: string;
}
const read = (p: { get(k: string): string | null }): Filters => ({
  status: readFilter(p.get('status')),
  seller: p.get('seller') ?? '',
  q: p.get('q') ?? '',
});
/** Адрес раздела с фильтрами — ссылкой открывается тот же список. */
const listingsUrl = (f: Filters) =>
  withQuery('/admin', { tab: 'listings', status: f.status, seller: f.seller, q: f.q.trim() });

/**
 * Лоты: по 50 и «Показать ещё», свежие сверху; фильтры по статусу со
 * счётчиками, лоты одного продавца (клик по нику), поиск по названию, нику
 * продавца или id. Блокировка — с причиной, которую увидит продавец; у
 * заблокированного — когда, кто и за что. У администратора — история лота
 * в журнале. Раньше здесь были 50 последних без продолжения и счётчиков, а
 * причины блокировки в консоли не было. Фильтры — в адресе страницы.
 */
export function ListingsSection({ isAdmin }: { isAdmin: boolean }) {
  const { dialog, ask } = useDecisionDialog();
  const params = useSearchParams();
  const [f, setF] = useState<Filters>(() => read(params));
  const [text, setText] = useState(f.q);
  const [working, setWorking] = useState<string | null>(null);
  // Ник продавца для фильтра — с лота, по которому кликнули.
  const [sellerLabel, setSellerLabel] = useState<string | null>(null);

  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.seller) p.set('seller', f.seller);
  if (f.q) p.set('q', f.q);
  const s = p.toString();
  const { rows, setRows, next, counts, setCounts, head, busy, err, setErr, more } = usePaged<Row, Counts, Page>(
    s ? `/moderation/listings?${s}` : '/moderation/listings',
    'Не удалось загрузить лоты.',
  );

  // Адрес сменили снаружи (ссылкой) — список за ним.
  useEffect(() => {
    if (!isCurrentQuery(params)) return;
    const n = read(params);
    setF(n);
    setText(n.q);
  }, [params]);

  function go(change: Partial<Filters>) {
    const n = { ...f, ...change, q: (change.q ?? f.q).trim() };
    setF(n);
    replaceUrl(listingsUrl(n));
  }

  /** Лоты продавца: обычный клик — на месте, с Ctrl или колёсиком — в новой вкладке. */
  const sellerLink = (l: Row) => ({
    href: listingsUrl({ ...f, seller: l.seller.id, q: '' }),
    onClick: (e: MouseEvent) => {
      if (!isPlainClick(e)) return;
      e.preventDefault();
      setSellerLabel(l.seller.profile?.username ?? null);
      setText('');
      go({ seller: l.seller.id, q: '' });
    },
  });

  /**
   * После блокировки строка берётся с сервера заново — статус, кто и за
   * что — и остаётся на месте. Не подходит под фильтр — уходит из списка;
   * счётчики сдвигаются.
   */
  async function setListing(l: Row, to: 'active' | 'blocked') {
    // Блокировка — с пунктом правил и причиной: продавец видит их и может
    // обжаловать (часть 134). Снятие блокировки — без вопросов.
    const d =
      to === 'blocked'
        ? await ask({ title: `Заблокировать «${l.title}»?`, hint: 'Причину и пункт увидит продавец и сможет обжаловать.', confirm: 'Заблокировать' })
        : { reason: '' };
    if (!d) return;
    setWorking(l.id);
    setErr(null);
    try {
      await apiFetch(`/moderation/listings/${l.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: to, ...(d.reason ? { reason: d.reason } : {}), ...(d.rule ? { rule: d.rule } : {}) }),
      });
      const page = await apiFetch<Page>(`/moderation/listings?q=${l.id}`).catch(() => null);
      const fresh = page?.items.find((x) => x.id === l.id);
      if (!fresh) return;
      setRows((prev) => prev && (fits(fresh, f.status) ? prev.map((x) => (x.id === l.id ? fresh : x)) : prev.filter((x) => x.id !== l.id)));
      const from = countOf(l.status);
      const into = countOf(fresh.status);
      if (from !== into) {
        setCounts((c) => {
          if (!c) return c;
          const n = { ...c };
          if (from) n[from] = Math.max(0, n[from] - 1);
          if (into) n[into] += 1;
          return n;
        });
      }
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось изменить лот.'));
    } finally {
      setWorking(null);
    }
  }

  const total = counts ? counts[FILTERS.find((x) => x.key === f.status)!.count] : null;
  const sellerName = sellerLabel ?? head?.seller?.username ?? f.seller.slice(0, 8);

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      {dialog}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          go({ q: text });
        }}
        className="row"
        style={{ gap: 8, flexWrap: 'wrap' }}
      >
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Название, ник продавца или id лота"
          value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск лотов" />
        <button className="btn secondary" type="submit">Найти</button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((x) => (
          <button key={x.key || 'all'} type="button" className="chip" aria-pressed={f.status === x.key} onClick={() => go({ status: x.key })}>
            {x.label}
            {counts && <span className="notif-group-count">{counts[x.count]}</span>}
          </button>
        ))}
      </div>
      {f.seller && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="chip" aria-label={`Убрать фильтр: продавец ${sellerName}`}
            onClick={() => {
              setSellerLabel(null);
              go({ seller: '' });
            }}>
            продавец {sellerName} <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        err ? null : <Empty>{f.q ? 'Ничего не найдено.' : 'Таких лотов нет.'}</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((l) => (
            <div key={l.id} className="card" style={{ padding: 16 }}>
              <div className="row" style={{ gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 220 }}>
                  {/* Лот на проверке публично не открывается — текст ниже, в карточке. */}
                  {l.status === 'review' ? (
                    <span style={{ fontWeight: 600 }}>{l.title}</span>
                  ) : (
                    <Link href={`/lot/${l.id}`} style={{ fontWeight: 600 }}>{l.title}</Link>
                  )}
                  <span className="faint" style={{ display: 'block', marginTop: 4, fontSize: 13 }}>
                    {[
                      `${l.game.title} · ${l.category.title}`,
                      formatPrice(l.price, l.currency),
                      l.stock !== null ? `в наличии ${l.stock}` : null,
                      `выставлен ${when(l.createdAt)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="row faint" style={{ gap: 8, marginTop: 4, fontSize: 13, flexWrap: 'wrap', alignItems: 'center' }}>
                    {f.seller === l.seller.id ? (
                      <span>{l.seller.profile?.username ?? 'продавец'}</span>
                    ) : (
                      <a {...sellerLink(l)} title="Все лоты продавца">{l.seller.profile?.username ?? 'продавец'}</a>
                    )}
                    <Link href={`/prodavec/${l.seller.id}`} aria-label="Страница продавца" title="Страница продавца">↗</Link>
                    {l.seller.status !== 'active' && <StatusBadge status={l.seller.status} labels={USER_STATUS} />}
                    {isAdmin && (
                      <>
                        <span aria-hidden="true">·</span>
                        <Link href={withQuery('/admin', { tab: 'audit', entity: `listing:${l.id}` })}>история</Link>
                      </>
                    )}
                  </span>
                </span>
                <span className="row" style={{ gap: 8 }}>
                  <StatusBadge status={l.status} labels={LISTING_STATUS} />
                  {l.status === 'blocked' ? (
                    <button type="button" className="chip" disabled={working === l.id} onClick={() => void setListing(l, 'active')}>
                      Разблокировать
                    </button>
                  ) : l.status === 'review' ? (
                    <>
                      <button type="button" className="chip" disabled={working === l.id} onClick={() => void setListing(l, 'active')}>
                        Одобрить
                      </button>
                      <button type="button" className="chip" disabled={working === l.id} onClick={() => void setListing(l, 'blocked')}>
                        Заблокировать
                      </button>
                    </>
                  ) : (
                    l.status !== 'archived' && (
                      <button type="button" className="chip" disabled={working === l.id} onClick={() => void setListing(l, 'blocked')}>
                        Заблокировать
                      </button>
                    )
                  )}
                </span>
              </div>
              {l.status === 'review' && (
                <div className="hint" style={{ margin: '10px 0 0', display: 'grid', gap: 6 }}>
                  {l.reviewReason && (
                    <span>
                      Найдено: <b>«{l.reviewReason}»</b> — похоже на передачу аккаунта. Одобрите, если это не так.
                    </span>
                  )}
                  {l.description && (
                    <span style={{ whiteSpace: 'pre-wrap', color: 'var(--fg)' }}>
                      {l.description.length > 600 ? `${l.description.slice(0, 600)}…` : l.description}
                    </span>
                  )}
                </div>
              )}
              {l.block && l.status === 'blocked' && (
                <p className="hint" style={{ margin: '10px 0 0' }}>
                  Заблокирован {when(l.block.at)}
                  {l.block.by ? ` · ${l.block.by}` : ''}
                  {l.block.reason ? ` · «${l.block.reason}»` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {!!rows?.length && (next || total !== null) && (
        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {next && (
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void more()}>
              {busy ? '…' : 'Показать ещё'}
            </button>
          )}
          {total !== null && (
            <span className="faint" style={{ fontSize: 13 }}>
              Показано {rows.length} из {total}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
