'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { Empty, LISTING_STATUS, StatusBadge, USER_STATUS, when } from './shared';

interface Person { id: string; username: string | null; status: string }
/** Карточка очереди — одна цель и все её жалобы (у решённых — одно решение). */
interface Row {
  /** Последняя жалоба карточки: решение по ней закрывает их все. */
  id: string;
  targetType: 'listing' | 'user' | 'message';
  targetId: string;
  status: string;
  /** Когда решили или отклонили. */
  handledAt: string | null;
  reports: number;
  firstAt: string;
  lastAt: string;
  reasons: Array<{ reason: string; count: number }>;
  /** Три последние жалобы: кто, по какой причине и что написал. */
  latest: Array<{ reporter: string | null; reason: string; details: string | null; createdAt: string }>;
  target: { title?: string; listingStatus?: string; text?: string; user: Person | null } | null;
}

interface Page {
  items: Row[];
  /** С какой карточки продолжать «Показать ещё»; null — показаны все. */
  next: string | null;
  /** Сколько целей и жалоб ждут решения; решённые не считаются. */
  counts: { open: number; openReports: number };
}

const FILTERS = [
  { key: '', label: 'Открытые' },
  { key: 'resolved', label: 'Решённые' },
  { key: 'rejected', label: 'Отклонённые' },
];
const KIND = { listing: 'Лот', user: 'Пользователь', message: 'Сообщение в чате' };

/** «1 жалоба», «3 жалобы», «250 жалоб». */
function complaints(n: number) {
  const ten = n % 10;
  const hundred = n % 100;
  const word = ten === 1 && hundred !== 11 ? 'жалоба' : ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14) ? 'жалобы' : 'жалоб';
  return `${n} ${word}`;
}

/**
 * Очередь жалоб: одна карточка на цель — сколько жалоб и по каким
 * причинам, что писали последние, кто нарушитель — и решение одной кнопкой
 * для всех её жалоб. Открытые — по первой жалобе, от старых к новым,
 * решённые — свежие решения сверху; по 50 и «Показать ещё».
 */
export function ReportsSection() {
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [open, setOpen] = useState<Page['counts'] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Ответ на прежний фильтр новый список не перетирает.
  const current = useRef('');

  const url = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams();
      if (filter) p.set('status', filter);
      if (cursor) p.set('cursor', cursor);
      return `/moderation/reports?${p}`;
    },
    [filter],
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
        setOpen(p.counts);
      })
      .catch((e) => {
        if (current.current !== key) return;
        setRows([]);
        setNext(null);
        setErr(apiErrorMessage(e, 'Не удалось загрузить жалобы.'));
      });
  }, [url]);

  async function loadMore() {
    if (!next || more) return;
    const key = current.current;
    setMore(true);
    setErr(null);
    try {
      const p = await apiFetch<Page>(url(next));
      if (current.current !== key) return;
      setRows((prev) => {
        const seen = new Set((prev ?? []).map((r) => r.id));
        return [...(prev ?? []), ...p.items.filter((r) => !seen.has(r.id))];
      });
      setNext(p.next);
      setOpen(p.counts);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось загрузить жалобы.'));
    } finally {
      setMore(false);
    }
  }

  async function handle(r: Row, status: 'resolved' | 'rejected', action?: 'block_listing' | 'freeze_user' | 'ban_user') {
    const who = r.target?.user?.username ?? 'пользователя';
    if (action === 'ban_user' && !window.confirm(`Забанить ${who}? Он не сможет войти, его лоты уйдут из каталога.`)) return;
    if (action === 'freeze_user' && !window.confirm(`Заморозить ${who}? Покупки, продажи и вывод станут недоступны.`)) return;
    setBusy(r.id);
    setErr(null);
    try {
      await apiFetch(`/moderation/reports/${r.id}/handle`, { method: 'POST', body: JSON.stringify({ status, action }) });
      // Решение закрывает все жалобы карточки — она уходит из списка сразу,
      // подгруженные страницы остаются на месте.
      setRows((prev) => prev?.filter((x) => x.id !== r.id) ?? prev);
      setOpen((c) => c && { open: Math.max(0, c.open - 1), openReports: Math.max(0, c.openReports - r.reports) });
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось обработать жалобу.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
            {f.key === '' && open !== null && <span className="notif-group-count">{open.open}</span>}
          </button>
        ))}
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        err ? null : <Empty>{filter ? 'Таких жалоб нет.' : 'Открытых жалоб нет.'}</Empty>
      ) : (
        rows.map((r) => {
          const t = r.target;
          const open = r.status === 'open' || r.status === 'reviewing';
          const many = r.reports > 1;
          const names = [...new Set(r.latest.map((x) => x.reporter ?? 'пользователь'))];
          return (
            <article key={r.id} className="card" style={{ padding: 20 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 700 }}>{r.reasons[0]?.reason ?? 'Жалоба'}</span>
                <span className="faint" style={{ fontSize: 13 }}>
                  {many
                    ? `${complaints(r.reports)} · ${when(r.firstAt)} — ${when(r.lastAt)}`
                    : `${names[0] ?? 'пользователь'} · ${when(r.lastAt)}`}
                </span>
              </div>
              {r.reasons.length > 1 && (
                <p className="faint" style={{ margin: '4px 0 0', fontSize: 13 }}>
                  {r.reasons.map((x) => `${x.reason} ${x.count}`).join(' · ')}
                </p>
              )}
              {r.latest
                .filter((x) => x.details)
                .map((x) => (
                  <p key={x.createdAt} className="muted" style={{ margin: '8px 0 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>
                    {x.details}
                    {many && <span className="faint" style={{ fontSize: 13 }}> — {x.reporter ?? 'пользователь'}, {when(x.createdAt)}</span>}
                  </p>
                ))}
              {many && (
                <p className="faint" style={{ margin: '6px 0 0', fontSize: 13 }}>
                  Последние жаловались: {names.join(', ')}
                </p>
              )}

              <div className="card flat" style={{ marginTop: 12, padding: 14, background: 'var(--page)' }}>
                <div className="faint" style={{ fontSize: 12 }}>{KIND[r.targetType]}</div>
                {!t ? (
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>Удалено или не найдено.</p>
                ) : (
                  <>
                    {r.targetType === 'listing' && (
                      <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                        <Link href={`/lot/${r.targetId}`} style={{ fontWeight: 600 }}>{t.title}</Link>
                        {t.listingStatus && <StatusBadge status={t.listingStatus} labels={LISTING_STATUS} />}
                      </div>
                    )}
                    {r.targetType === 'message' && (
                      <p style={{ margin: '4px 0 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>«{t.text}»</p>
                    )}
                    {t.user && (
                      <div className="row" style={{ gap: 8, marginTop: 6, fontSize: 14, flexWrap: 'wrap' }}>
                        <span className="faint">{r.targetType === 'listing' ? 'Продавец' : r.targetType === 'message' ? 'Автор' : 'Аккаунт'}</span>
                        <Link href={`/prodavec/${t.user.id}`}>{t.user.username ?? t.user.id.slice(0, 8)}</Link>
                        <StatusBadge status={t.user.status} labels={USER_STATUS} />
                      </div>
                    )}
                  </>
                )}
              </div>

              {open ? (
                <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  {r.targetType === 'listing' && t && t.listingStatus !== 'blocked' && (
                    <button type="button" className="btn" disabled={busy === r.id} onClick={() => void handle(r, 'resolved', 'block_listing')}>
                      Заблокировать лот
                    </button>
                  )}
                  {t?.user && t.user.status === 'active' && (
                    <>
                      <button type="button" className="chip" disabled={busy === r.id} onClick={() => void handle(r, 'resolved', 'freeze_user')}>
                        Заморозить
                      </button>
                      <button type="button" className="chip" disabled={busy === r.id} onClick={() => void handle(r, 'resolved', 'ban_user')}>
                        Забанить
                      </button>
                    </>
                  )}
                  <button type="button" className="chip" disabled={busy === r.id} onClick={() => void handle(r, 'resolved')}>
                    Решено без действий
                  </button>
                  <button type="button" className="chip" disabled={busy === r.id} onClick={() => void handle(r, 'rejected')}>
                    Отклонить
                  </button>
                </div>
              ) : (
                <p className="hint" style={{ marginTop: 10 }}>
                  {r.status === 'resolved' ? 'Решено' : 'Отклонено'}
                  {r.handledAt ? ` ${when(r.handledAt)}` : ''}
                  {many ? ` · ${complaints(r.reports)}` : ''}
                </p>
              )}
            </article>
          );
        })
      )}
      {!!rows?.length && (next || (!filter && open !== null)) && (
        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {next && (
            <button type="button" className="btn secondary" disabled={more} onClick={() => void loadMore()}>
              {more ? '…' : 'Показать ещё'}
            </button>
          )}
          {!filter && open !== null && (
            <span className="faint" style={{ fontSize: 13 }}>
              Показано {rows.length} из {open.open} · всего {complaints(open.openReports)}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
