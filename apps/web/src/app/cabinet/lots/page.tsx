'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUp, ArrowUpRight, CheckCircle2, Palmtree, Search, X } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { CabinetNav } from '@/components/cabinet-nav';
import { MyLotRow, type MyLot } from '@/components/my-lot-row';

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
  ['all', 'Все'],
  ['active', 'В продаже'],
  ['paused', 'Сняты'],
  ['sold_out', 'Закончились'],
  ['blocked', 'Заблокированы'],
];

const inFilter = (l: MyLot, f: Filter) =>
  f === 'all' || (f === 'paused' ? l.status === 'paused' || l.status === 'draft' : l.status === f);

function bulkNote(action: 'pause' | 'activate' | 'bump', r: BulkResult): string {
  if (action === 'bump') {
    const parts = [`Подняли: ${r.done}`];
    if (r.waiting && r.nextInMinutes != null) parts.push(`остальные — через ${r.nextInMinutes} мин`);
    if (r.skipped) parts.push(`не в продаже: ${r.skipped}`);
    return `${parts.join(', ')}.`;
  }
  if (action === 'pause') {
    return `Сняли с продажи: ${r.done}.${r.skipped ? ` Пропустили ${r.skipped} — уже сняты или закончились.` : ''}`;
  }
  return `Вернули в продажу: ${r.done}.${r.skipped ? ` Пропустили ${r.skipped} — уже в продаже, без наличия или заблокированы.` : ''}`;
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
    const t = q.trim().toLowerCase();
    const out: Array<{ categoryId: string; title: string; href: string; items: MyLot[] }> = [];
    for (const r of rows ?? []) {
      if (!inFilter(r, filter) || (t && !r.title.toLowerCase().includes(t))) continue;
      let g = out.find((x) => x.categoryId === r.categoryId);
      if (!g) {
        g = {
          categoryId: r.categoryId,
          title: `${r.game.title} · ${r.category.title}`,
          href: `/igra/${r.game.slug}/${r.category.slug}`,
          items: [],
        };
        out.push(g);
      }
      g.items.push(r);
    }
    return out;
  }, [rows, filter, q]);

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
      setFlash(bulkNote(action, r));
      setSelected(new Set());
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не получилось. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  }

  async function goAway(on: boolean) {
    if (
      on &&
      !window.confirm(
        `Снять с продажи все лоты в продаже (${counts.active})? Вернуть их можно одной кнопкой. Открытые заказы отпуск не отменяет — их нужно довести.`,
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
      setFlash(on ? `Вы в отпуске: сняли с продажи ${r.paused ?? 0}.` : `С возвращением: вернули в продажу ${r.restored ?? 0}.`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не получилось. Попробуйте ещё раз.'));
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
      if (r.bumped) parts.push(`поднято: ${r.bumped}`);
      if (r.waiting && r.nextInMinutes != null) parts.push(`остальные — через ${r.nextInMinutes} мин`);
      setNotes((n) => ({ ...n, [categoryId]: parts.join(', ') || 'нечего поднимать' }));
      await load();
    } catch (e) {
      setNotes((n) => ({ ...n, [categoryId]: apiErrorMessage(e, 'не удалось поднять') }));
    } finally {
      setBusy(false);
    }
  }

  const awaySince = away?.awaySince ? new Date(away.awaySince).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null;

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
          <h1 className="h1" style={{ fontSize: 32 }}>
            Мои лоты
          </h1>
          <Link href="/cabinet/new" className="btn">
            Продать лот
          </Link>
        </div>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {params.get('updated') && (
        <div className="alert success" role="status">
          <CheckCircle2 size={18} strokeWidth={1.75} />
          <span>Изменения сохранены.</span>
        </div>
      )}
      {awaySince && (
        <div className="away-banner" role="status">
          <Palmtree size={22} strokeWidth={1.75} aria-hidden />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 700 }}>Вы в отпуске с {awaySince}</div>
            <p>
              Снятые на время отпуска лоты ({away?.paused ?? 0}) вернутся в продажу одной кнопкой. В профиле покупатели
              видят пометку «в отпуске».
            </p>
          </div>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void goAway(false)}>
            Вернуться к продажам
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
        <div aria-busy="true" aria-label="Загружаем лоты">
          <div className="skeleton" style={{ height: 120 }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card flat row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span className="muted">Лотов пока нет. Выставить первый — пара минут.</span>
          <Link href="/cabinet/new" className="btn secondary">
            Создать лот
          </Link>
        </div>
      ) : (
        <>
          <div className="lots-toolbar">
            <div className="lots-filter" role="group" aria-label="Какие лоты показать">
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
                  {label} <span className="faint">{counts[f]}</span>
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
                  placeholder="Найти лот"
                  aria-label="Найти лот по названию"
                />
              </div>
              {!awaySince && (
                <button
                  type="button"
                  className="chip"
                  disabled={busy || counts.active === 0}
                  title="Снять все лоты разом и вернуть их одной кнопкой"
                  onClick={() => void goAway(true)}
                >
                  <Palmtree size={16} strokeWidth={1.75} aria-hidden /> В отпуск
                </button>
              )}
            </div>
          </div>

          {groups.length === 0 && <p className="muted">Ничего не нашлось.</p>}
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
                    aria-label={`Выбрать все: ${g.title}`}
                  />
                  <h2 className="my-lots-title" id={`g-${g.categoryId}`}>
                    {g.title} <span className="faint">· {g.items.length}</span>
                  </h2>
                  <span className="my-lots-head-side">
                    {notes[g.categoryId] && <span className="faint" style={{ fontSize: 13 }}>{notes[g.categoryId]}</span>}
                    {g.items.some((l) => l.status === 'active') && (
                      <button type="button" className="chip" disabled={busy} onClick={() => void bumpAll(g.categoryId)}>
                        <ArrowUp size={14} strokeWidth={1.75} /> Поднять все
                      </button>
                    )}
                    <Link href={g.href} className="chip" title="Раздел на витрине">
                      Раздел <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
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
            <div className="bulk-bar" role="region" aria-label="Действия с выбранными лотами">
              <span className="bulk-count">Выбрано {selected.size}</span>
              <button type="button" className="chip" disabled={busy} onClick={() => void bulk('activate')}>
                Вернуть в продажу
              </button>
              <button type="button" className="chip" disabled={busy} onClick={() => void bulk('pause')}>
                Снять с продажи
              </button>
              <button type="button" className="chip" disabled={busy} onClick={() => void bulk('bump')}>
                <ArrowUp size={14} strokeWidth={1.75} /> Поднять
              </button>
              <button type="button" className="icon-btn" aria-label="Снять выбор" title="Снять выбор" onClick={() => setSelected(new Set())}>
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
