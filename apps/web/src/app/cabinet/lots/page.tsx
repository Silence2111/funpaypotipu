'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUp, CheckCircle2, Pencil, Trash2 } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatListingPrice, formatQty } from '@/lib/format';
import { BumpButton } from '@/components/bump-button';
import { PromoteButton } from '@/components/promote-button';
import { CabinetNav } from '@/components/cabinet-nav';

interface Row {
  id: string;
  title: string;
  price: string;
  currency: string;
  status: string;
  boostUntil?: string | null;
  promotedUntil?: string | null;
  topupMarkupBps?: number | null;
  fulfillmentType?: string;
  unitName?: string | null;
  pricePerUnits?: number;
  stock?: number | null;
  categoryId: string;
  category: { slug: string; title: string };
  game: { slug: string; title: string };
}

const STATUS_RU: Record<string, string> = {
  active: 'в продаже',
  draft: 'черновик',
  paused: 'снят с продажи',
  sold_out: 'закончился',
  blocked: 'заблокирован',
};

export default function MyLotsPage() {
  return (
    <Suspense fallback={null}>
      <MyLots />
    </Suspense>
  );
}

/**
 * Мои лоты — как «Мои предложения» на FunPay: лоты сгруппированы по разделам
 * игры, у раздела — «Поднять все», у лота — изменить, снять, удалить.
 */
function MyLots() {
  const router = useRouter();
  const params = useSearchParams();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await apiFetch<Row[]>('/listings/mine').catch(() => []));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/lots');
      return;
    }
    void load();
  }, [router, load]);

  async function act(id: string, fn: () => Promise<unknown>, fallback: string) {
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

  const setStatus = (l: Row, status: 'active' | 'paused') =>
    act(
      l.id,
      () => apiFetch(`/listings/${l.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
      'Не удалось изменить статус лота.',
    );

  const remove = (l: Row) => {
    if (!window.confirm(`Удалить «${l.title}»? Если по лоту были заказы, он уйдёт в архив — история сделок сохранится.`)) return;
    void act(l.id, () => apiFetch(`/listings/${l.id}`, { method: 'DELETE' }), 'Не удалось удалить лот.');
  };

  async function bumpAll(categoryId: string) {
    setBusy(categoryId);
    try {
      const r = await apiFetch<{ bumped: number; waiting: number; nextInMinutes: number | null }>(
        '/listings/bump-all',
        { method: 'POST', body: JSON.stringify({ categoryId }) },
      );
      const parts: string[] = [];
      if (r.bumped) parts.push(`поднято: ${r.bumped}`);
      if (r.waiting && r.nextInMinutes != null) parts.push(`остальные — через ${r.nextInMinutes} мин`);
      setNotes((n) => ({ ...n, [categoryId]: parts.join(', ') || 'нечего поднимать' }));
      await load();
    } catch (e) {
      setNotes((n) => ({ ...n, [categoryId]: apiErrorMessage(e, 'не удалось поднять') }));
    } finally {
      setBusy(null);
    }
  }

  // Группы «игра · раздел» в порядке первого лота: свежие разделы сверху.
  const groups: Array<{ categoryId: string; title: string; items: Row[] }> = [];
  for (const r of rows ?? []) {
    let g = groups.find((x) => x.categoryId === r.categoryId);
    if (!g) {
      g = { categoryId: r.categoryId, title: `${r.game.title} · ${r.category.title}`, items: [] };
      groups.push(g);
    }
    g.items.push(r);
  }

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
          <h1 className="h1" style={{ fontSize: 32 }}>Мои лоты</h1>
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
      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}

      {rows === null ? (
        <div aria-busy="true" aria-label="Загружаем лоты">
          <div className="skeleton" style={{ height: 120 }} />
        </div>
      ) : groups.length === 0 ? (
        <div className="card flat row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span className="muted">Лотов пока нет. Выставить первый — пара минут.</span>
          <Link href="/cabinet/new" className="btn secondary">
            Создать лот
          </Link>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.categoryId}>
            <div className="section-head" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <h2 className="h2" style={{ fontSize: 18 }}>
                {g.title} <span className="faint" style={{ fontWeight: 500 }}>· {g.items.length}</span>
              </h2>
              <span className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                {notes[g.categoryId] && <span className="faint" style={{ fontSize: 13 }}>{notes[g.categoryId]}</span>}
                {g.items.some((l) => l.status === 'active') && (
                  <button
                    type="button"
                    className="chip"
                    disabled={busy === g.categoryId}
                    onClick={() => void bumpAll(g.categoryId)}
                  >
                    <ArrowUp size={14} strokeWidth={2} /> Поднять все
                  </button>
                )}
              </span>
            </div>
            <div className="grid" style={{ gap: 8 }}>
              {g.items.map((l) => (
                <div key={l.id} className="card row" style={{ justifyContent: 'space-between', padding: 16, gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ flex: 1, minWidth: 180 }}>
                    {l.status === 'active' || l.status === 'sold_out' ? (
                      <Link href={`/lot/${l.id}`} style={{ fontWeight: 600 }}>
                        {l.title}
                      </Link>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{l.title}</span>
                    )}
                    <span className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <span className="price" style={{ fontSize: 15 }}>
                        {formatListingPrice(l)}
                      </span>
                      <span className={l.status === 'active' ? 'badge success' : l.status === 'blocked' ? 'badge danger' : 'badge'}>
                        {STATUS_RU[l.status] ?? l.status}
                      </span>
                      {l.stock != null && (l.unitName || l.fulfillmentType === 'auto_key') && l.status !== 'sold_out' && (
                        <span className="faint" style={{ fontSize: 13 }}>в наличии {formatQty(l.stock, l.unitName)}</span>
                      )}
                    </span>
                  </span>
                  {l.status === 'blocked' ? (
                    <span className="hint">Заблокирован модератором. Если это ошибка — напишите в поддержку.</span>
                  ) : l.status === 'sold_out' ? (
                    // Распроданный лот возвращается в продажу пополнением, а не кнопкой:
                    // без наличия его всё равно нельзя купить.
                    <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {l.fulfillmentType === 'auto_key' ? (
                        <Link href={`/lot/${l.id}#keys`} className="chip">
                          Загрузить ключи
                        </Link>
                      ) : (
                        <Link href={`/cabinet/lot/${l.id}`} className="chip">
                          <Pencil size={14} strokeWidth={1.75} /> Пополнить наличие
                        </Link>
                      )}
                      <button
                        type="button"
                        className="chip"
                        disabled={busy === l.id}
                        onClick={() => remove(l)}
                        aria-label={`Удалить «${l.title}»`}
                      >
                        <Trash2 size={14} strokeWidth={1.75} /> Удалить
                      </button>
                    </span>
                  ) : (
                    <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {l.status === 'active' && <BumpButton key={l.boostUntil ?? l.id} listingId={l.id} boostUntil={l.boostUntil} />}
                      {l.status === 'active' && (
                        <PromoteButton listingId={l.id} promotedUntil={l.promotedUntil} onDone={() => void load()} />
                      )}
                      <Link href={`/cabinet/lot/${l.id}`} className="chip">
                        <Pencil size={14} strokeWidth={1.75} /> Изменить
                      </Link>
                      {l.status === 'active' ? (
                        <button type="button" className="chip" disabled={busy === l.id} onClick={() => void setStatus(l, 'paused')}>
                          Снять с продажи
                        </button>
                      ) : (
                        <button type="button" className="chip" disabled={busy === l.id} onClick={() => void setStatus(l, 'active')}>
                          Вернуть в продажу
                        </button>
                      )}
                      <button
                        type="button"
                        className="chip"
                        disabled={busy === l.id}
                        onClick={() => remove(l)}
                        aria-label={`Удалить «${l.title}»`}
                      >
                        <Trash2 size={14} strokeWidth={1.75} /> Удалить
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
