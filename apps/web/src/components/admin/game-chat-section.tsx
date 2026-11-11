'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { Empty, StatusBadge, USER_STATUS, when } from './shared';

interface Row {
  id: string;
  body: string;
  createdAt: string;
  deletedAt: string | null;
  deleteReason: string | null;
  openReports: number;
  game: { slug: string; title: string };
  user: { id: string; status: string; profile: { username: string; chatMutedUntil: string | null } | null };
}

type Filter = '' | 'reported' | 'deleted';
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: '', label: 'Все' },
  { key: 'reported', label: 'С жалобами' },
  { key: 'deleted', label: 'Удалённые' },
];
const MUTES = [
  { hours: 24, label: 'на сутки' },
  { hours: 168, label: 'на неделю' },
  { hours: 720, label: 'на месяц' },
];

/**
 * Чаты игр в консоли (часть 133): лента сообщений всех игр, новые сверху;
 * «С жалобами» — то, на что жаловались и что ещё не решено; поиск по тексту
 * и нику. Удаление — с причиной, запрет писать — на сутки, неделю или
 * месяц; всё в журнал.
 */
export function GameChatSection() {
  const [filter, setFilter] = useState<Filter>('');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const url = useCallback(
    (before?: string) => {
      const p = new URLSearchParams();
      if (filter) p.set(filter, '1');
      if (query) p.set('q', query);
      if (before) p.set('before', before);
      const s = p.toString();
      return s ? `/moderation/game-chat?${s}` : '/moderation/game-chat';
    },
    [filter, query],
  );

  useEffect(() => {
    setRows(null);
    apiFetch<{ items: Row[]; next: string | null }>(url())
      .then((r) => {
        setRows(r.items);
        setNext(r.next);
      })
      .catch((e) => setErr(apiErrorMessage(e, 'Не удалось загрузить чаты.')));
  }, [url]);

  async function act(row: Row, fn: () => Promise<unknown>, fallback: string, patch: Partial<Row>) {
    setBusy(row.id);
    setErr(null);
    try {
      await fn();
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, ...patch } : r)) ?? null);
    } catch (e) {
      setErr(apiErrorMessage(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  function remove(row: Row) {
    const reason = window.prompt('Удалить сообщение? Причина:', 'Нарушение правил чата');
    if (reason === null || reason.trim().length < 3) return;
    void act(
      row,
      () => apiFetch(`/moderation/game-chat/${row.id}/delete`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }),
      'Не удалось удалить.',
      { deletedAt: new Date().toISOString(), deleteReason: reason.trim(), openReports: 0 },
    );
  }

  function mute(row: Row, hours: number) {
    const name = row.user.profile?.username ?? row.user.id.slice(0, 8);
    const reason = hours ? window.prompt(`Запретить ${name} писать в чаты игр? Причина:`, 'Спам и реклама') : '';
    if (reason === null) return;
    const until = hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : null;
    void act(
      row,
      () => apiFetch(`/moderation/game-chat/users/${row.user.id}/mute`, { method: 'POST', body: JSON.stringify({ hours, reason: reason.trim() }) }),
      'Не удалось изменить запрет.',
      { user: { ...row.user, profile: row.user.profile ? { ...row.user.profile, chatMutedUntil: until } : null } },
    );
  }

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
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Текст или ник" value={text}
          onChange={(e) => setText(e.target.value)} aria-label="Поиск по чатам игр" />
        <button className="btn secondary" type="submit">Найти</button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.key || 'all'} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        <Empty>{query ? 'Ничего не нашли.' : 'Сообщений нет.'}</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((r) => {
            const muted = r.user.profile?.chatMutedUntil && new Date(r.user.profile.chatMutedUntil) > new Date() ? r.user.profile.chatMutedUntil : null;
            return (
              <div key={r.id} className="card" style={{ padding: 14 }}>
                <div className="row" style={{ gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
                  <Link href={`/prodavec/${r.user.id}`} style={{ fontWeight: 600 }}>{r.user.profile?.username ?? r.user.id.slice(0, 8)}</Link>
                  <StatusBadge status={r.user.status} labels={USER_STATUS} />
                  <Link href={`/igra/${r.game.slug}`} className="faint">{r.game.title}</Link>
                  <span className="faint">{when(r.createdAt)}</span>
                  {r.openReports > 0 && <span className="badge warning">жалоб: {r.openReports}</span>}
                  {muted && <span className="badge">нельзя писать до {when(muted)}</span>}
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 15, whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: r.deletedAt ? 0.6 : 1 }}>
                  {r.body}
                </p>
                {r.deletedAt && (
                  <p className="hint" style={{ margin: '4px 0 0' }}>
                    Удалено {when(r.deletedAt)}{r.deleteReason ? ` · «${r.deleteReason}»` : ''}
                  </p>
                )}
                <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {!r.deletedAt && (
                    <button type="button" className="chip" disabled={busy === r.id} onClick={() => remove(r)}>Удалить</button>
                  )}
                  {muted ? (
                    <button type="button" className="chip" disabled={busy === r.id} onClick={() => mute(r, 0)}>Снять запрет</button>
                  ) : (
                    MUTES.map((m) => (
                      <button key={m.hours} type="button" className="chip" disabled={busy === r.id} onClick={() => mute(r, m.hours)}>
                        Запретить писать {m.label}
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {next && rows && (
        <button type="button" className="btn secondary" style={{ justifySelf: 'start' }}
          onClick={async () => {
            const r = await apiFetch<{ items: Row[]; next: string | null }>(url(next)).catch(() => null);
            if (!r) return setErr('Не удалось загрузить ещё.');
            setRows((prev) => [...(prev ?? []), ...r.items]);
            setNext(r.next);
          }}>
          Показать ещё
        </button>
      )}
    </section>
  );
}
