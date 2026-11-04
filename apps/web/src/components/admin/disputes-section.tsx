'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { isCurrentQuery, replaceUrl } from '@/lib/url';
import { disputeUrl, disputesQueueUrl, readDisputesState, type DisputesState } from '@/lib/disputes-queue';
import { Empty, when } from './shared';

interface Row {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  messages: number;
  buyer: string | null;
  seller: string | null;
  arbiter: string | null;
  awaitingFrom: 'buyer' | 'seller' | null;
  respondBy: string | null;
  missedBy: 'buyer' | 'seller' | null;
  order: { publicNumber: string; amount: string; currency: string; title: string | null } | null;
}

/** Сколько открытых (из них пропустили срок) и решённых; в поиске — найденных. */
interface Counts {
  open: number;
  missed: number;
  closed: number;
}

interface Page {
  items: Row[];
  /** С какого спора продолжать «Показать ещё»; null — показаны все. */
  next: string | null;
  counts: Counts;
}

const WHO = { buyer: 'покупатель', seller: 'продавец' } as const;
const WHOM = { buyer: 'покупателя', seller: 'продавца' } as const;
const OUTCOME: Record<string, string> = {
  resolved_buyer: 'в пользу покупателя',
  resolved_seller: 'в пользу продавца',
  cancelled: 'закрыт без претензий',
};

/**
 * Очередь споров: сумма, стороны, кто взял, чей ход. Открытые — кто
 * пропустил срок ответа, сверху (такой спор можно решать по тому, что
 * есть), дальше от старых; «Решённые» — чем кончился спор, свежие сверху.
 * По 50 и «Показать ещё», поиск — по номеру заказа, лоту и никам сторон.
 * Раньше открытые грузились все разом, а решённых здесь не было вовсе.
 *
 * Вкладка и поиск — в адресе: «Назад» и «← Очередь споров» со страницы спора
 * возвращают к тому же списку.
 */
export function DisputesSection() {
  const params = useSearchParams();
  const [state, setState] = useState<DisputesState>(readDisputesState(params.get('state')));
  const [text, setText] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Ответ на прежнюю вкладку или поиск новый список не перетирает.
  const current = useRef('');

  // Адрес сменили снаружи (ссылкой) — список за ним.
  useEffect(() => {
    if (!isCurrentQuery(params)) return;
    setState(readDisputesState(params.get('state')));
    setQuery(params.get('q') ?? '');
    setText(params.get('q') ?? '');
  }, [params]);

  function go(change: { state?: DisputesState; q?: string }) {
    const s = change.state ?? state;
    const q = (change.q ?? query).trim();
    setState(s);
    setQuery(q);
    replaceUrl(disputesQueueUrl(s, q));
  }

  const url = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams({ state });
      if (query) p.set('q', query);
      if (cursor) p.set('cursor', cursor);
      return `/disputes/queue?${p}`;
    },
    [state, query],
  );

  useEffect(() => {
    const key = url();
    current.current = key;
    setRows(null);
    setErr(null);
    apiFetch<Page>(key)
      .then((p) => {
        if (current.current !== key) return;
        setRows(p.items);
        setNext(p.next);
        setCounts(p.counts);
      })
      .catch((e) => {
        if (current.current !== key) return;
        setRows([]);
        setNext(null);
        setErr(apiErrorMessage(e, 'Не удалось загрузить споры.'));
      });
  }, [url]);

  async function more() {
    if (!next || busy) return;
    const key = current.current;
    setBusy(true);
    setErr(null);
    try {
      const p = await apiFetch<Page>(url(next));
      if (current.current !== key) return;
      setRows((prev) => {
        const seen = new Set((prev ?? []).map((r) => r.id));
        return [...(prev ?? []), ...p.items.filter((r) => !seen.has(r.id))];
      });
      setNext(p.next);
      setCounts(p.counts);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось загрузить споры.'));
    } finally {
      setBusy(false);
    }
  }

  const total = counts ? counts[state] : null;
  const back = disputesQueueUrl(state, query);

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          go({ q: text });
        }}
        className="row"
        style={{ gap: 8, flexWrap: 'wrap' }}
      >
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Номер заказа, лот или ник"
          value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск споров" />
        <button className="btn secondary" type="submit">Найти</button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="chip" aria-pressed={state === 'open'} onClick={() => go({ state: 'open' })}>
          Открытые
          {counts && <span className="notif-group-count">{counts.open}</span>}
        </button>
        <button type="button" className="chip" aria-pressed={state === 'closed'} onClick={() => go({ state: 'closed' })}>
          Решённые
          {counts && <span className="notif-group-count">{counts.closed}</span>}
        </button>
        {state === 'open' && !!counts?.missed && (
          <span className="faint" style={{ fontSize: 13 }}>пропустили срок ответа: {counts.missed}</span>
        )}
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        err ? null : <Empty>{query ? 'Ничего не нашлось.' : state === 'open' ? 'Открытых споров нет.' : 'Решённых споров нет.'}</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((d) => (
            <Link key={d.id} href={disputeUrl(d.id, back)} className="card link" style={{ padding: 18, display: 'block' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{d.order?.title ?? d.order?.publicNumber ?? 'Заказ'}</span>
                {d.order && <span className="price" style={{ fontSize: 15 }}>{formatPrice(d.order.amount, d.order.currency)}</span>}
              </div>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>{d.reason}</p>
              <div className="row faint" style={{ gap: 8, marginTop: 8, fontSize: 13, flexWrap: 'wrap' }}>
                {OUTCOME[d.status] ? (
                  <span className="badge">
                    {OUTCOME[d.status]}
                    {d.resolvedAt ? ` · ${when(d.resolvedAt)}` : ''}
                    {d.arbiter ? ` · ${d.arbiter}` : ''}
                  </span>
                ) : (
                  <>
                    <span className={d.status === 'open' ? 'badge accent' : 'badge'}>
                      {d.status === 'open' ? 'ждёт арбитра' : `в работе${d.arbiter ? ` · ${d.arbiter}` : ''}`}
                    </span>
                    {d.missedBy && <span className="badge warning">{WHO[d.missedBy]} не ответил в срок</span>}
                    {d.awaitingFrom && d.respondBy && (
                      <span className="badge">ждём {WHOM[d.awaitingFrom]} до {when(d.respondBy)}</span>
                    )}
                  </>
                )}
                <span>
                  {[d.order?.publicNumber, `покупатель ${d.buyer ?? '—'}`, `продавец ${d.seller ?? '—'}`, `открыт ${when(d.createdAt)}`, `сообщений: ${d.messages}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            </Link>
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
