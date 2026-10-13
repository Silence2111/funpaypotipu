'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { Empty, LISTING_STATUS, StatusBadge, USER_STATUS } from './shared';

interface Row {
  id: string;
  title: string;
  status: string;
  price: string;
  currency: string;
  game: { title: string };
  category: { title: string };
  seller: { id: string; status: string; profile: { username: string } | null };
}

const FILTERS = [
  { key: '', label: 'Все' },
  { key: 'active', label: 'В продаже' },
  { key: 'blocked', label: 'Заблокированные' },
];

/** Лоты: поиск по названию, продавцу или id; блокировка с причиной, которую увидит продавец. */
export function ListingsSection() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (status) p.set('status', status);
    setRows(await apiFetch<Row[]>(`/moderation/listings?${p}`).catch(() => []));
  }, [query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setListing(l: Row, next: 'active' | 'blocked') {
    const reason =
      next === 'blocked' ? window.prompt(`Причина блокировки «${l.title}» — её увидит продавец`, 'Нарушение правил площадки') : '';
    if (reason === null) return;
    setBusy(l.id);
    setErr(null);
    try {
      await apiFetch(`/moderation/listings/${l.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: next, ...(reason ? { reason } : {}) }),
      });
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось изменить лот.'));
    } finally {
      setBusy(null);
    }
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setQuery(q.trim());
  }

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      <form onSubmit={onSearch} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Название, продавец или id лота"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск лотов" />
        <button className="btn secondary" type="submit">Найти</button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={status === f.key} onClick={() => setStatus(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        <Empty>Ничего не найдено.</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((l) => (
            <div key={l.id} className="card row" style={{ padding: 16, gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 220 }}>
                <Link href={`/lot/${l.id}`} style={{ fontWeight: 600 }}>{l.title}</Link>
                <span className="row faint" style={{ gap: 8, marginTop: 4, fontSize: 13, flexWrap: 'wrap' }}>
                  {l.game.title} · {l.category.title} · {formatPrice(l.price, l.currency)}
                  <span>·</span>
                  <Link href={`/prodavec/${l.seller.id}`}>{l.seller.profile?.username ?? 'продавец'}</Link>
                  {l.seller.status !== 'active' && <StatusBadge status={l.seller.status} labels={USER_STATUS} />}
                </span>
              </span>
              <span className="row" style={{ gap: 8 }}>
                <StatusBadge status={l.status} labels={LISTING_STATUS} />
                {l.status === 'blocked' ? (
                  <button type="button" className="chip" disabled={busy === l.id} onClick={() => void setListing(l, 'active')}>
                    Разблокировать
                  </button>
                ) : (
                  l.status !== 'archived' && (
                    <button type="button" className="chip" disabled={busy === l.id} onClick={() => void setListing(l, 'blocked')}>
                      Заблокировать
                    </button>
                  )
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
