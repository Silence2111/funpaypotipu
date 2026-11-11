'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { isCurrentQuery, replaceUrl, withQuery } from '@/lib/url';
import { presenceText } from '@/lib/presence';
import { Empty, ROLE_LABEL, StatusBadge, USER_STATUS, when } from './shared';
import { usePaged, type Paged } from './use-paged';
import { UserRisk } from './user-risk';
import { AntifraudSettingsCard } from './antifraud-settings';

type UserStatus = 'active' | 'frozen' | 'banned';
type Filter = '' | UserStatus | 'staff';
type Counts = Record<'all' | UserStatus | 'staff', number>;

interface Row {
  id: string;
  email: string | null;
  status: UserStatus;
  createdAt: string;
  roles: string[];
  /** Сколько лотов сейчас в продаже. */
  activeListings: number;
  /** Риск-балл за 30 дней — сумма сигналов антифрода (часть 128). */
  risk?: number;
  /** `onlineAt` — когда последний раз был на сайте. */
  profile: { username: string; salesCount: number; ratingAvg: number; ratingCount: number; onlineAt: string | null } | null;
  /** У замороженного и забаненного — когда, кто и за что. */
  restriction: { at: string; by: string | null; reason: string | null } | null;
}

const FILTERS: Array<{ key: Filter; count: keyof Counts; label: string }> = [
  { key: '', count: 'all', label: 'Все' },
  { key: 'active', count: 'active', label: 'Активные' },
  { key: 'frozen', count: 'frozen', label: 'Замороженные' },
  { key: 'banned', count: 'banned', label: 'Забаненные' },
  { key: 'staff', count: 'staff', label: 'Сотрудники' },
];
const readFilter = (v: string | null): Filter => FILTERS.find((f) => f.key === v)?.key ?? '';
/** Адрес раздела с фильтром и поиском — ссылкой открывается тот же список. */
const usersUrl = (status: Filter, q: string) => withQuery('/admin', { tab: 'users', status, q: q.trim() });
/** Роли, которые выдаёт администратор. Покупатель и продавец — у всех по умолчанию. */
const STAFF = ['moderator', 'agent', 'finance', 'admin'];
const isStaff = (u: Row) => u.roles.some((r) => STAFF.includes(r));
const RESTRICTED: Record<string, string> = { frozen: 'Заморожен', banned: 'Забанен' };

const fits = (u: Row, f: Filter) => (f === '' ? true : f === 'staff' ? isStaff(u) : u.status === f);

/**
 * Пользователи: по 50 и «Показать ещё», новые сверху; фильтры по статусу и
 * «Сотрудники» со счётчиками, поиск по нику, почте или id. У замороженного и
 * забаненного — когда, кто и за что; у каждого — когда заходил и сколько
 * лотов в продаже (ссылкой — его лоты в консоли). Заморозка и бан — с
 * причиной; роли сотрудников — только у администратора (`isAdmin`), у него
 * же — история пользователя в журнале. Раньше здесь были 50 последних без
 * продолжения и счётчиков. Фильтр и поиск — в адресе страницы.
 */
export function UsersSection({ isAdmin, meId }: { isAdmin: boolean; meId: string | null }) {
  const params = useSearchParams();
  const [status, setStatus] = useState<Filter>(readFilter(params.get('status')));
  const [text, setText] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [working, setWorking] = useState<string | null>(null);
  // Открытая карточка «Риск и связи» (часть 128).
  const [riskOpen, setRiskOpen] = useState<string | null>(null);

  const p = new URLSearchParams();
  if (status) p.set('status', status);
  if (query) p.set('q', query);
  const s = p.toString();
  const { rows, setRows, next, counts, setCounts, busy, err, setErr, more } = usePaged<Row, Counts>(
    s ? `/moderation/users?${s}` : '/moderation/users',
    'Не удалось загрузить пользователей.',
  );

  // Адрес сменили снаружи (ссылкой) — список за ним.
  useEffect(() => {
    if (!isCurrentQuery(params)) return;
    setStatus(readFilter(params.get('status')));
    setQuery(params.get('q') ?? '');
    setText(params.get('q') ?? '');
  }, [params]);

  function go(change: { status?: Filter; q?: string }) {
    const st = change.status ?? status;
    const q = (change.q ?? query).trim();
    setStatus(st);
    setQuery(q);
    replaceUrl(usersUrl(st, q));
  }

  /**
   * После действия строка берётся с сервера заново — статус, кто и за что
   * ограничил, лоты в продаже, роли — и остаётся на месте, а подгруженные
   * страницы не перезагружаются. Не подходит под фильтр — уходит из списка;
   * счётчики сдвигаются.
   */
  async function run(u: Row, fn: () => Promise<unknown>, fallback: string) {
    setWorking(u.id);
    setErr(null);
    try {
      await fn();
      const page = await apiFetch<Paged<Row, Counts>>(`/moderation/users?q=${u.id}`).catch(() => null);
      const fresh = page?.items.find((x) => x.id === u.id);
      if (!fresh) return;
      setRows((prev) => prev && (fits(fresh, status) ? prev.map((x) => (x.id === u.id ? fresh : x)) : prev.filter((x) => x.id !== u.id)));
      setCounts((c) => {
        if (!c) return c;
        const n = { ...c };
        if (fresh.status !== u.status) {
          n[u.status] = Math.max(0, n[u.status] - 1);
          n[fresh.status] += 1;
        }
        if (isStaff(fresh) !== isStaff(u)) n.staff = Math.max(0, n.staff + (isStaff(fresh) ? 1 : -1));
        return n;
      });
    } catch (e) {
      setErr(apiErrorMessage(e, fallback));
    } finally {
      setWorking(null);
    }
  }

  function setUserStatus(u: Row, to: UserStatus) {
    const name = u.profile?.username ?? u.email ?? u.id.slice(0, 8);
    const question =
      to === 'banned'
        ? `Забанить ${name}? Сессии закроются, лоты уйдут из каталога. Причина:`
        : to === 'frozen'
          ? `Заморозить ${name}? Покупки, продажи и вывод станут недоступны. Причина:`
          : `Снять ограничения с ${name}? Лоты, снятые блокировкой, вернутся в продажу. Комментарий:`;
    const reason = window.prompt(question, to === 'active' ? '' : 'Нарушение правил площадки');
    if (reason === null) return;
    void run(
      u,
      () =>
        apiFetch(`/moderation/users/${u.id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: to, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
        }),
      'Не удалось изменить статус.',
    );
  }

  function toggleRole(u: Row, role: string) {
    const has = u.roles.includes(role);
    if (!window.confirm(`${has ? 'Снять' : 'Выдать'} роль «${ROLE_LABEL[role]}» пользователю ${u.profile?.username ?? u.email}?`)) return;
    void run(
      u,
      () =>
        apiFetch(`/admin/users/${u.id}/roles${has ? '/revoke' : ''}`, {
          method: 'POST',
          body: JSON.stringify({ roleKey: role }),
        }),
      'Не удалось изменить роль.',
    );
  }

  const total = counts ? counts[FILTERS.find((f) => f.key === status)!.count] : null;

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      {isAdmin && <AntifraudSettingsCard />}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          go({ q: text });
        }}
        className="row"
        style={{ gap: 8, flexWrap: 'wrap' }}
      >
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Ник, почта или id"
          value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск пользователей" />
        <button className="btn secondary" type="submit">Найти</button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.key || 'all'} type="button" className="chip" aria-pressed={status === f.key} onClick={() => go({ status: f.key })}>
            {f.label}
            {counts && <span className="notif-group-count">{counts[f.count]}</span>}
          </button>
        ))}
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        err ? null : <Empty>{query ? 'Никого не нашли.' : 'Таких пользователей нет.'}</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((u) => {
            const me = u.id === meId;
            const busyRow = working === u.id;
            return (
              <div key={u.id} className="card" style={{ padding: 16 }}>
                <div className="row" style={{ gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 200, flex: 1 }}>
                    <Link href={`/prodavec/${u.id}`} style={{ fontWeight: 600 }}>{u.profile?.username ?? u.id.slice(0, 8)}</Link>
                    <span className="faint" style={{ display: 'block', fontSize: 13 }}>
                      {[
                        u.email ?? 'без почты',
                        `с ${new Date(u.createdAt).toLocaleDateString('ru-RU')}`,
                        presenceText(u.profile?.onlineAt) ?? 'активности ещё не было',
                        u.profile ? `продаж ${u.profile.salesCount}` : null,
                        u.profile?.ratingCount ? `рейтинг ${u.profile.ratingAvg.toFixed(1)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="row faint" style={{ gap: 12, marginTop: 4, fontSize: 13, flexWrap: 'wrap' }}>
                      <Link href={withQuery('/admin', { tab: 'listings', seller: u.id })}>
                        {u.activeListings ? `лотов в продаже: ${u.activeListings}` : 'лоты'}
                      </Link>
                      {isAdmin && <Link href={withQuery('/admin', { tab: 'audit', entity: `user:${u.id}` })}>история</Link>}
                      <button type="button" className="inline-link" aria-expanded={riskOpen === u.id}
                        style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}
                        onClick={() => setRiskOpen((x) => (x === u.id ? null : u.id))}>
                        риск и связи
                      </button>
                      {!!u.risk && <span className={u.risk >= 30 ? 'badge danger' : 'badge warning'}>риск {u.risk}</span>}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <StatusBadge status={u.status} labels={USER_STATUS} />
                    {!me && u.status !== 'frozen' && u.status !== 'banned' && (
                      <button type="button" className="chip" disabled={busyRow} onClick={() => setUserStatus(u, 'frozen')}>
                        Заморозить
                      </button>
                    )}
                    {!me && u.status !== 'banned' && (
                      <button type="button" className="chip" disabled={busyRow} onClick={() => setUserStatus(u, 'banned')}>
                        Забанить
                      </button>
                    )}
                    {!me && u.status !== 'active' && (
                      <button type="button" className="chip" disabled={busyRow} onClick={() => setUserStatus(u, 'active')}>
                        Снять ограничения
                      </button>
                    )}
                  </span>
                </div>
                {riskOpen === u.id && <UserRisk userId={u.id} />}
                {u.restriction && (
                  <p className="hint" style={{ margin: '10px 0 0' }}>
                    {RESTRICTED[u.status]} {when(u.restriction.at)}
                    {u.restriction.by ? ` · ${u.restriction.by}` : ''}
                    {u.restriction.reason ? ` · «${u.restriction.reason}»` : ''}
                  </p>
                )}
                {(isAdmin || isStaff(u)) && (
                  <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <span className="faint" style={{ fontSize: 13 }}>Роли:</span>
                    {STAFF.map((r) =>
                      isAdmin ? (
                        <button key={r} type="button" className="chip" aria-pressed={u.roles.includes(r)}
                          disabled={busyRow || (me && r === 'admin')} onClick={() => toggleRole(u, r)}>
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
