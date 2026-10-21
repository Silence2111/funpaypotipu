'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUp, ArrowUpRight, BarChart3, CheckCircle2, Palmtree, Search, X } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { CabinetNav } from '@/components/cabinet-nav';
import { MyLotRow, type MyLot } from '@/components/my-lot-row';
import { useT } from '@/lib/i18n/client';
import { msg, type T } from '@/lib/i18n/lang';

/** Отпуск продавца — ответ `GET /listings/away`. */
interface Away {
  awaySince: string | null;
  paused: number;
}

interface BulkResult {
  done: number;
  skipped: number;
  waiting?: number;
  nextInMinutes?: number | null;
}

type Filter = 'all' | 'active' | 'paused' | 'sold_out' | 'blocked';

const FILTERS: Array<[Filter, string]> = [
  ['all', msg('Все')],
  ['active', msg('В продаже')],
  ['paused', msg('Сняты')],
  ['sold_out', msg('Закончились')],
  ['blocked', msg('Заблокированы')],
];

const inFilter = (l: MyLot, f: Filter) =>
  f === 'all' || (f === 'paused' ? l.status === 'paused' || l.status === 'draft' : l.status === f);

function bulkNote(action: 'pause' | 'activate' | 'bump', r: BulkResult, t: T): string {
  if (action === 'bump') {
    const parts = [t('Подняли: {n}', { n: r.done })];
    if (r.waiting && r.nextInMinutes != null) parts.push(t('остальные — через {n} мин', { n: r.nextInMinutes }));
    if (r.skipped) parts.push(t('не в продаже: {n}', { n: r.skipped }));
    return `${parts.join(', ')}.`;
  }
  if (action === 'pause') {
    const done = t('Сняли с продажи: {n}.', { n: r.done });
    return r.skipped ? `${done} ${t('Пропустили {n} — уже сняты или закончились.', { n: r.skipped })}` : done;
  }
  const done = t('Вернули в продажу: {n}.', { n: r.done });
  return r.skipped
    ? `${done} ${t('Пропустили {n} — уже в продаже, без наличия или заблокированы.', { n: r.skipped })}`
    : done;
}

export default function MyLotsPage() {
  return (
    <Suspense fallback={null}>
      <MyLots />
    </Suspense>
  );
}

/**
 * Мои лоты — как «Мои предложения» на FunPay: лоты по разделам игр, цена
 * правится прямо в строке, переключатель «В продаже», галочки для действий
 * над несколькими лотами и «Отпуск» — снять всё разом и вернуть одной кнопкой.
 */
function MyLots() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [rows, setRows] = useState<MyLot[] | null>(null);
  const [away, setAway] = useState<Away | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, a] = await Promise.all([
      apiFetch<MyLot[]>('/listings/mine').catch(() => [] as MyLot[]),
      apiFetch<Away>('/listings/away').catch(() => null),
    ]);
    setRows(list);
    setAway(a);
    // Удалённый лот не должен оставаться выбранным.
    setSelected((s) => new Set([...s].filter((id) => list.some((l) => l.id === id))));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/lots');
      return;
    }
    void load();
  }, [router, load]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, active: 0, paused: 0, sold_out: 0, blocked: 0 };
    for (const l of rows ?? []) for (const [f] of FILTERS) if (inFilter(l, f)) c[f] += 1;
    return c;
  }, [rows]);

  // Группы «игра · раздел» в порядке первого лота: свежие разделы сверху.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: Array<{ categoryId: string; title: string; href: string; items: MyLot[] }> = [];
    for (const r of rows ?? []) {
      if (!inFilter(r, filter) || (needle && !r.title.toLowerCase().includes(needle))) continue;
      let g = out.find((x) => x.categoryId === r.categoryId);
      if (!g) {
        g = {
          categoryId: r.categoryId,
          title: `${t.d(r.game.title)} · ${t.d(r.category.title)}`,
          href: `/igra/${r.game.slug}/${r.category.slug}`,
          items: [],
        };
        out.push(g);
      }
      g.items.push(r);
    }
    return out;
  }, [rows, filter, q, t]);

  function pick(ids: string[], on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function bulk(action: 'pause' | 'activate' | 'bump') {
    setBusy(true);
    setErr(null);
    setFlash(null);
    try {
      const r = await apiFetch<BulkResult>('/listings/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids: [...selected], action }),
      });
      setFlash(bulkNote(action, r, t));
      setSelected(new Set());
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не получилось. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
    }
  }

  async function goAway(on: boolean) {
    if (
      on &&
      !window.confirm(
        t(
          'Снять с продажи все лоты в продаже ({n})? Вернуть их можно одной кнопкой. Открытые заказы отпуск не отменяет — их нужно довести.',
          { n: counts.active },
        ),
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    setFlash(null);
    try {
      const r = await apiFetch<{ paused?: number; restored?: number }>('/listings/away', {
        method: 'POST',
        body: JSON.stringify({ away: on }),
      });
      setFlash(
        on
          ? t('Вы в отпуске: сняли с продажи {n}.', { n: r.paused ?? 0 })
          : t('С возвращением: вернули в продажу {n}.', { n: r.restored ?? 0 }),
      );
      setSelected(new Set());
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не получилось. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
    }
  }

  async function bumpAll(categoryId: string) {
    setBusy(true);
    try {
      const r = await apiFetch<{ bumped: number; waiting: number; nextInMinutes: number | null }>('/listings/bump-all', {
        method: 'POST',
        body: JSON.stringify({ categoryId }),
      });
      const parts: string[] = [];
      if (r.bumped) parts.push(t('поднято: {n}', { n: r.bumped }));
      if (r.waiting && r.nextInMinutes != null) parts.push(t('остальные — через {n} мин', { n: r.nextInMinutes }));
      setNotes((n) => ({ ...n, [categoryId]: parts.join(', ') || t('нечего поднимать') }));
      await load();
    } catch (e) {
      setNotes((n) => ({ ...n, [categoryId]: apiErrorMessage(e, t('не удалось поднять')) }));
    } finally {
      setBusy(false);
    }
  }

  const awaySince = away?.awaySince
    ? new Date(away.awaySince).toLocaleDateString(t.locale, { day: 'numeric', month: 'long' })
    : null;

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
          <h1 className="h1" style={{ fontSize: 32 }}>
            {t('Мои лоты')}
          </h1>
          <div className="row" style={{ gap: 8 }}>
            <Link href="/cabinet/lots/stats" className="btn secondary">
              <BarChart3 size={16} strokeWidth={1.75} aria-hidden /> {t('Статистика')}
            </Link>
            <Link href="/cabinet/new" className="btn">
              {t('Продать лот')}
            </Link>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {params.get('updated') && (
        <div className="alert success" role="status">
          <CheckCircle2 size={18} strokeWidth={1.75} />
          <span>{t('Изменения сохранены.')}</span>
        </div>
      )}
      {awaySince && (
        <div className="away-banner" role="status">
          <Palmtree size={22} strokeWidth={1.75} aria-hidden />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 700 }}>{t('Вы в отпуске с {date}', { date: awaySince })}</div>
            <p>
              {t(
                'Снятые на время отпуска лоты ({n}) вернутся в продажу одной кнопкой. В профиле покупатели видят пометку «в отпуске».',
                { n: away?.paused ?? 0 },
              )}
            </p>
          </div>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void goAway(false)}>
            {t('Вернуться к продажам')}
          </button>
        </div>
      )}
      {flash && (
        <div className="alert success" role="status">
          <CheckCircle2 size={18} strokeWidth={1.75} />
          <span>{flash}</span>
        </div>
      )}
      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}

      {rows === null ? (
        <div aria-busy="true" aria-label={t('Загружаем лоты')}>
          <div className="skeleton" style={{ height: 120 }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card flat row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span className="muted">{t('Лотов пока нет. Выставить первый — пара минут.')}</span>
          <Link href="/cabinet/new" className="btn secondary">
            {t('Создать лот')}
          </Link>
        </div>
      ) : (
        <>
          <div className="lots-toolbar">
            <div className="lots-filter" role="group" aria-label={t('Какие лоты показать')}>
              {FILTERS.filter(([f]) => f === 'all' || counts[f] > 0).map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  className="chip"
                  aria-pressed={filter === f}
                  onClick={() => {
                    setFilter(f);
                    setSelected(new Set());
                  }}
                >
                  {t(label)} <span className="faint">{counts[f]}</span>
                </button>
              ))}
            </div>
            <div className="lots-toolbar-side">
              <div className="filter-search">
                <Search size={16} strokeWidth={1.75} aria-hidden />
                <input
                  className="input"
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('Найти лот')}
                  aria-label={t('Найти лот по названию')}
                />
              </div>
              {!awaySince && (
                <button
                  type="button"
                  className="chip"
                  disabled={busy || counts.active === 0}
                  title={t('Снять все лоты разом и вернуть их одной кнопкой')}
                  onClick={() => void goAway(true)}
                >
                  <Palmtree size={16} strokeWidth={1.75} aria-hidden /> {t('В отпуск')}
                </button>
              )}
            </div>
          </div>

          {groups.length === 0 && <p className="muted">{t('Ничего не нашлось.')}</p>}
          {groups.map((g) => {
            const ids = g.items.map((l) => l.id);
            const chosen = ids.filter((id) => selected.has(id)).length;
            return (
              <section key={g.categoryId} aria-labelledby={`g-${g.categoryId}`}>
                <div className="my-lots-head">
                  <input
                    type="checkbox"
                    checked={chosen === ids.length}
                    ref={(el) => {
                      if (el) el.indeterminate = chosen > 0 && chosen < ids.length;
                    }}
                    onChange={(e) => pick(ids, e.target.checked)}
                    aria-label={t('Выбрать все: {name}', { name: g.title })}
                  />
                  <h2 className="my-lots-title" id={`g-${g.categoryId}`}>
                    {g.title} <span className="faint">· {g.items.length}</span>
                  </h2>
                  <span className="my-lots-head-side">
                    {notes[g.categoryId] && <span className="faint" style={{ fontSize: 13 }}>{notes[g.categoryId]}</span>}
                    {g.items.some((l) => l.status === 'active') && (
                      <button type="button" className="chip" disabled={busy} onClick={() => void bumpAll(g.categoryId)}>
                        <ArrowUp size={14} strokeWidth={1.75} /> {t('Поднять все')}
                      </button>
                    )}
                    <Link href={g.href} className="chip" title={t('Раздел на витрине')}>
                      {t('Раздел')} <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
                    </Link>
                  </span>
                </div>
                <div className="my-lots">
                  {g.items.map((l) => (
                    <MyLotRow
                      key={l.id}
                      lot={l}
                      selected={selected.has(l.id)}
                      onSelect={(on) => pick([l.id], on)}
                      onChanged={() => void load()}
                      onError={setErr}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {selected.size > 0 && (
            <div className="bulk-bar" role="region" aria-label={t('Действия с выбранными лотами')}>
              <span className="bulk-count">{t('Выбрано {n}', { n: selected.size })}</span>
              <button type="button" className="chip" disabled={busy} onClick={() => void bulk('activate')}>
                {t('Вернуть в продажу')}
              </button>
              <button type="button" className="chip" disabled={busy} onClick={() => void bulk('pause')}>
                {t('Снять с продажи')}
              </button>
              <button type="button" className="chip" disabled={busy} onClick={() => void bulk('bump')}>
                <ArrowUp size={14} strokeWidth={1.75} /> {t('Поднять')}
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={t('Снять выбор')}
                title={t('Снять выбор')}
                onClick={() => setSelected(new Set())}
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
