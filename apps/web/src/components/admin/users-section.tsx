'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { Empty, ROLE_LABEL, StatusBadge, USER_STATUS } from './shared';

interface Row {
  id: string;
  email: string | null;
  status: string;
  createdAt: string;
  roles: string[];
  profile: { username: string; salesCount: number; ratingAvg: number; ratingCount: number } | null;
}

const FILTERS = [
  { key: '', label: 'Все' },
  { key: 'frozen', label: 'Замороженные' },
  { key: 'banned', label: 'Забаненные' },
];
/** Роли, которые выдаёт администратор. Покупатель и продавец — у всех по умолчанию. */
const STAFF = ['moderator', 'agent', 'finance', 'admin'];

/**
 * Пользователи: поиск по нику, почте или id; заморозка и бан с причиной.
 * Роли сотрудников — только у администратора (`isAdmin`).
 */
export function UsersSection({ isAdmin, meId }: { isAdmin: boolean; meId: string | null }) {
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
    setRows(await apiFetch<Row[]>(`/moderation/users?${p}`).catch(() => []));
  }, [query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(id: string, fn: () => Promise<unknown>, fallback: string) {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  function setUserStatus(u: Row, next: 'active' | 'frozen' | 'banned') {
    const name = u.profile?.username ?? u.email ?? u.id.slice(0, 8);
    const question =
      next === 'banned'
        ? `Забанить ${name}? Сессии закроются, лоты уйдут из каталога. Причина:`
        : next === 'frozen'
          ? `Заморозить ${name}? Покупки, продажи и вывод станут недоступны. Причина:`
          : `Снять ограничения с ${name}? Лоты, снятые блокировкой, вернутся в продажу. Комментарий:`;
    const reason = window.prompt(question, next === 'active' ? '' : 'Нарушение правил площадки');
    if (reason === null) return;
    void run(
      u.id,
      () =>
        apiFetch(`/moderation/users/${u.id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: next, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
        }),
      'Не удалось изменить статус.',
    );
  }

  function toggleRole(u: Row, role: string) {
    const has = u.roles.includes(role);
    if (!window.confirm(`${has ? 'Снять' : 'Выдать'} роль «${ROLE_LABEL[role]}» пользователю ${u.profile?.username ?? u.email}?`)) return;
    void run(
      u.id,
      () =>
        apiFetch(`/admin/users/${u.id}/roles${has ? '/revoke' : ''}`, {
          method: 'POST',
          body: JSON.stringify({ roleKey: role }),
        }),
      'Не удалось изменить роль.',
    );
  }

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
        className="row"
        style={{ gap: 8, flexWrap: 'wrap' }}
      >
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Ник, почта или id"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск пользователей" />
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
        <Empty>Никого не нашли.</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((u) => {
            const me = u.id === meId;
            return (
              <div key={u.id} className="card" style={{ padding: 16 }}>
                <div className="row" style={{ gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 200 }}>
                    <Link href={`/prodavec/${u.id}`} style={{ fontWeight: 600 }}>{u.profile?.username ?? '—'}</Link>
                    <span className="faint" style={{ display: 'block', fontSize: 13 }}>
                      {u.email ?? 'без почты'} · с {new Date(u.createdAt).toLocaleDateString('ru-RU')}
                      {u.profile ? ` · продаж ${u.profile.salesCount}` : ''}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <StatusBadge status={u.status} labels={USER_STATUS} />
                    {!me && u.status !== 'frozen' && u.status !== 'banned' && (
                      <button type="button" className="chip" disabled={busy === u.id} onClick={() => setUserStatus(u, 'frozen')}>
                        Заморозить
                      </button>
                    )}
                    {!me && u.status !== 'banned' && (
                      <button type="button" className="chip" disabled={busy === u.id} onClick={() => setUserStatus(u, 'banned')}>
                        Забанить
                      </button>
                    )}
                    {!me && u.status !== 'active' && (
                      <button type="button" className="chip" disabled={busy === u.id} onClick={() => setUserStatus(u, 'active')}>
                        Снять ограничения
                      </button>
                    )}
                  </span>
                </div>
                {(isAdmin || u.roles.some((r) => STAFF.includes(r))) && (
                  <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <span className="faint" style={{ fontSize: 13 }}>Роли:</span>
                    {STAFF.map((r) =>
                      isAdmin ? (
                        <button key={r} type="button" className="chip" aria-pressed={u.roles.includes(r)}
                          disabled={busy === u.id || (me && r === 'admin')} onClick={() => toggleRole(u, r)}>
                          {ROLE_LABEL[r]}
                        </button>
                      ) : (
                        u.roles.includes(r) && <span key={r} className="badge">{ROLE_LABEL[r]}</span>
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
