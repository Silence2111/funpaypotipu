'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { isCurrentQuery, replaceUrl, withQuery } from '@/lib/url';
import { formatPrice, timeLeft } from '@/lib/format';
import { DISPUTE_STATUS } from '@/lib/disputes';
import { CabinetNav } from '@/components/cabinet-nav';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';

type Side = 'buyer' | 'seller';

interface MyDispute {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  awaitingFrom: Side | null;
  respondBy: string | null;
  missedBy: Side | null;
  side: Side;
  myTurn: boolean;
  order: {
    id: string;
    publicNumber: string;
    amount: string;
    currency: string;
    title: string | null;
  };
  counterpart: string | null;
}

interface Mine {
  items: MyDispute[];
  counts: { open: number; closed: number; myTurn: number };
  /** С какого спора продолжать «Показать ещё»; null — показаны все. */
  next: string | null;
}

/** Что сейчас со спором — одной строкой, с точки зрения этого человека. */
function stateOf(d: MyDispute, t: T): { text: string; tone: '' | 'warning' | 'success' } {
  if (d.myTurn && d.respondBy) {
    const left = timeLeft(d.respondBy, t);
    return {
      text: left ? t('Ваш ход — осталось {left}', { left }) : t('Ваш ход'),
      tone: 'warning',
    };
  }
  if (d.awaitingFrom && d.awaitingFrom !== d.side) {
    return {
      text: d.awaitingFrom === 'seller' ? t('Ждём ответа продавца') : t('Ждём ответа покупателя'),
      tone: '',
    };
  }
  if (d.status === 'resolved_buyer' || d.status === 'resolved_seller') {
    const mine = (d.status === 'resolved_buyer') === (d.side === 'buyer');
    return { text: t(DISPUTE_STATUS[d.status]!), tone: mine ? 'success' : '' };
  }
  return { text: DISPUTE_STATUS[d.status] ? t(DISPUTE_STATUS[d.status]!) : d.status, tone: '' };
}

/**
 * Споры в кабинете: все свои — и как покупателя, и как продавца. Открытые:
 * сверху те, где ждут вашего ответа, ближайший срок первым; закрытые —
 * отдельной вкладкой. Строка ведёт на страницу спора, где отвечают.
 */
function DisputesInner() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [state, setState] = useState<'open' | 'closed'>(
    params.get('state') === 'closed' ? 'closed' : 'open',
  );
  const [data, setData] = useState<Mine | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // «Показать ещё» дописывает только к той вкладке, с которой начинал.
  const current = useRef(state);

  useEffect(() => {
    if (!isCurrentQuery(params)) return;
    setState(params.get('state') === 'closed' ? 'closed' : 'open');
  }, [params]);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent('/cabinet/disputes')}`);
      return;
    }
    let stop = false;
    current.current = state;
    setData(null);
    setErr(null);
    apiFetch<Mine>(`/disputes/mine?state=${state}`)
      .then((r) => !stop && setData(r))
      .catch((e) => !stop && setErr(apiErrorMessage(e, t('Не удалось загрузить споры.'))));
    return () => {
      stop = true;
    };
  }, [state, router, t]);

  async function more() {
    if (!data?.next) return;
    const start = state;
    setBusy(true);
    try {
      const r = await apiFetch<Mine>(`/disputes/mine?state=${start}&before=${data.next}`);
      if (current.current !== start) return;
      // Спор мог сменить место, пока листали, — второй раз его не показываем.
      setData((prev) => {
        if (!prev) return r;
        const seen = new Set(prev.items.map((d) => d.id));
        return { ...r, items: [...prev.items, ...r.items.filter((d) => !seen.has(d.id))] };
      });
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось загрузить споры.')));
    } finally {
      setBusy(false);
    }
  }

  function show(next: 'open' | 'closed') {
    setState(next);
    replaceUrl(withQuery(pathname, { state: next === 'closed' && 'closed' }));
  }

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Споры')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t(
            'Споры по вашим покупкам и продажам. У стороны, от которой ждут ответа, 24 часа — пропущенный срок арбитр учтёт при решении.',
          )}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="chip"
          aria-pressed={state === 'open'}
          onClick={() => show('open')}
        >
          {t('Открытые')}
          {!!data?.counts.open && <span className="notif-group-count">{data.counts.open}</span>}
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={state === 'closed'}
          onClick={() => show('closed')}
        >
          {t('Закрытые')}
          {!!data?.counts.closed && <span className="notif-group-count">{data.counts.closed}</span>}
        </button>
        {!!data?.counts.myTurn && (
          <span className="badge warning">
            {t('Ждут вашего ответа: {n}', { n: data.counts.myTurn })}
          </span>
        )}
      </div>

      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}

      {data === null ? (
        !err && <div className="skeleton" style={{ height: 240 }} aria-busy="true" />
      ) : data.items.length === 0 ? (
        <div className="card flat empty-state">
          <p className="muted" style={{ maxWidth: '60ch', margin: 0 }}>
            {state === 'open'
              ? t(
                  'Открытых споров нет. Если с товаром что-то не так, спор открывают на странице заказа — деньги остаются у площадки, пока его не решат.',
                )
              : t('Закрытых споров пока нет.')}
          </p>
        </div>
      ) : (
        <div className="card notif-list">
          {data.items.map((d) => {
            const s = stateOf(d, t);
            const opened = new Date(d.createdAt).toLocaleDateString(t.locale, {
              day: 'numeric',
              month: 'short',
            });
            return (
              <Link
                key={d.id}
                href={`/disputes/${d.id}`}
                className={`dispute-row${d.myTurn ? ' mine' : ''}`}
              >
                <span className="dispute-main">
                  <span className="dispute-title">{d.order.title ?? d.order.publicNumber}</span>
                  <span className="dispute-sub">
                    {d.order.publicNumber} ·{' '}
                    {d.side === 'buyer'
                      ? t('вы покупатель, продавец {name}', { name: d.counterpart ?? '—' })
                      : t('вы продавец, покупатель {name}', { name: d.counterpart ?? '—' })}{' '}
                    · {t('открыт {date}', { date: opened })}
                  </span>
                  <span className="dispute-reason">{d.reason}</span>
                </span>
                <span className="dispute-side">
                  <span className={s.tone ? `badge ${s.tone}` : 'badge'}>{s.text}</span>
                  <span className="price" style={{ fontSize: 15 }}>
                    {formatPrice(d.order.amount, d.order.currency, t)}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
      {data?.next && (
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => void more()}
          style={{ alignSelf: 'center' }}
        >
          {busy ? '…' : t('Показать ещё')}
        </button>
      )}
    </div>
  );
}

export default function DisputesPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <DisputesInner />
    </Suspense>
  );
}
