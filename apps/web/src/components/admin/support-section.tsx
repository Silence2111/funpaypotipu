'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { SUPPORT_CATEGORY } from '@/components/support-ui';
import { Empty, when } from './shared';

interface Row {
  id: string;
  subject: string;
  category: string;
  status: string;
  lastMessageAt: string;
  messages: number;
  user: string | null;
  assignee: string | null;
}

type Status = 'open' | 'answered' | 'closed';

/** Сколько в каждом статусе (в поиске — найденных); закрытые без поиска не считаются. */
interface Counts {
  open: number;
  answered: number;
  closed: number | null;
}

interface Page {
  items: Row[];
  /** С какого обращения продолжать «Показать ещё»; null — показаны все. */
  next: string | null;
  counts: Counts;
}

const FILTERS: Array<{ key: Status; label: string }> = [
  { key: 'open', label: 'Ждут ответа' },
  { key: 'answered', label: 'Ждём пользователя' },
  { key: 'closed', label: 'Закрытые' },
];

/** Сколько обращение ждёт ответа: «40 мин», «5 ч», «2 д 4 ч». */
function waiting(iso: string, now: number) {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  return h % 24 ? `${Math.floor(h / 24)} д ${h % 24} ч` : `${h / 24} д`;
}

/**
 * Очередь поддержки: ждущие ответа — старые сверху, чтобы никто не ждал
 * дольше всех. По 50 и «Показать ещё», у фильтров — сколько обращений;
 * поиск — по теме, нику автора и номеру заказа. Раньше приходили 200 и всё:
 * при очереди больше двухсот новые обращения сюда не попадали.
 */
export function SupportSection() {
  const [status, setStatus] = useState<Status>('open');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Ответ на прежний фильтр или поиск новый список не перетирает.
  const current = useRef('');

  const url = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams({ status });
      if (query) p.set('q', query);
      if (cursor) p.set('cursor', cursor);
      return `/support/queue?${p}`;
    },
    [status, query],
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
        setErr(apiErrorMessage(e, 'Не удалось загрузить обращения.'));
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
      setErr(apiErrorMessage(e, 'Не удалось загрузить обращения.'));
    } finally {
      setBusy(false);
    }
  }

  const total = counts?.[status] ?? null;
  const now = Date.now();

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setQuery(text.trim());
        }}
        className="row"
        style={{ gap: 8, flexWrap: 'wrap' }}
      >
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Тема, ник или номер заказа"
          value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск обращений" />
        <button className="btn secondary" type="submit">Найти</button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={status === f.key} onClick={() => setStatus(f.key)}>
            {f.label}
            {counts?.[f.key] != null && <span className="notif-group-count">{counts[f.key]}</span>}
          </button>
        ))}
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 100 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        err ? null : <Empty>{query ? 'Ничего не нашлось.' : 'Обращений нет.'}</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((t) => (
            <Link key={t.id} href={`/cabinet/support/${t.id}`} className="card link" style={{ padding: 16, display: 'block' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{t.subject}</span>
                {t.status === 'open' ? (
                  <span className="faint" style={{ fontSize: 13 }} title={when(t.lastMessageAt)}>
                    ждёт {waiting(t.lastMessageAt, now)}
                  </span>
                ) : (
                  <span className="faint" style={{ fontSize: 13 }}>{when(t.lastMessageAt)}</span>
                )}
              </div>
              <div className="faint" style={{ fontSize: 13, marginTop: 4 }}>
                {SUPPORT_CATEGORY[t.category] ?? t.category} · {t.user ?? 'пользователь'} · сообщений: {t.messages}
                {t.assignee ? ` · ведёт ${t.assignee}` : ''}
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
