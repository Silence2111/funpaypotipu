'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { isCurrentQuery, replaceUrl, withQuery } from '@/lib/url';
import { Empty, LISTING_STATUS, StatusBadge, USER_STATUS, when } from './shared';
import { usePaged } from './use-paged';

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

/** Сколько целей и жалоб ждут решения (в поиске — найденных); решённые не считаются. */
type Counts = { open: number; openReports: number };

const FILTERS = [
  { key: '', label: 'Открытые' },
  { key: 'resolved', label: 'Решённые' },
  { key: 'rejected', label: 'Отклонённые' },
];
const readFilter = (v: string | null) => FILTERS.find((f) => f.key === v)?.key ?? '';
/** Адрес очереди с фильтром и поиском — ссылкой открывается тот же список. */
const reportsUrl = (status: string, q: string) => withQuery('/admin', { tab: 'reports', status, q: q.trim() });
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
 * решённые — свежие решения сверху; по 50 и «Показать ещё». Поиск — по нику
 * нарушителя или пожаловавшегося, названию лота, id цели или жалобы:
 * находится цель, и в карточке — все её жалобы. Раньше поиска не было, и
 * жалобы на конкретного человека находились, только если листать очередь.
 * Фильтр и поиск — в адресе страницы.
 */
export function ReportsSection() {
  const params = useSearchParams();
  const [filter, setFilter] = useState(readFilter(params.get('status')));
  const [text, setText] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [busy, setBusy] = useState<string | null>(null);

  const p = new URLSearchParams();
  if (filter) p.set('status', filter);
  if (query) p.set('q', query);
  const s = p.toString();
  const {
    rows,
    setRows,
    next,
    counts: open,
    setCounts: setOpen,
    busy: more,
    err,
    setErr,
    more: loadMore,
  } = usePaged<Row, Counts>(s ? `/moderation/reports?${s}` : '/moderation/reports', 'Не удалось загрузить жалобы.');

  // Адрес сменили снаружи (ссылкой) — список за ним.
  useEffect(() => {
    if (!isCurrentQuery(params)) return;
    setFilter(readFilter(params.get('status')));
    setQuery(params.get('q') ?? '');
    setText(params.get('q') ?? '');
  }, [params]);

  function go(change: { status?: string; q?: string }) {
    const st = change.status ?? filter;
    const q = (change.q ?? query).trim();
    setFilter(st);
    setQuery(q);
    replaceUrl(reportsUrl(st, q));
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
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          go({ q: text });
        }}
        className="row"
        style={{ gap: 8, flexWrap: 'wrap' }}
      >
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Ник нарушителя или пожаловавшегося, название лота, id"
          value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск жалоб" />
        <button className="btn secondary" type="submit">Найти</button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.key || 'open'} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => go({ status: f.key })}>
            {f.label}
            {f.key === '' && open !== null && <span className="notif-group-count">{open.open}</span>}
          </button>
        ))}
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        err ? null : <Empty>{query ? 'Ничего не нашлось.' : filter ? 'Таких жалоб нет.' : 'Открытых жалоб нет.'}</Empty>
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
