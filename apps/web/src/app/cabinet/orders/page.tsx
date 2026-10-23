'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { formatPrice, formatQty } from '@/lib/format';
import { CabinetNav } from '@/components/cabinet-nav';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

interface Row {
  id: string;
  publicNumber: string;
  status: string;
  amount: string;
  currency: string;
  createdAt: string;
  title: string | null;
  qty: number;
  /** Единица поштучного заказа; null — товар целиком. */
  unitName: string | null;
  counterparty: string | null;
  role: 'buyer' | 'seller';
}

const STATUS: Record<string, string> = {
  created: msg('ждёт оплаты'),
  paid: msg('оплачен'),
  delivered: msg('выдан'),
  completed: msg('завершён'),
  disputed: msg('спор'),
  refunded: msg('возврат'),
  cancelled: msg('отменён'),
  expired: msg('истёк'),
};

/** Фильтры как на FunPay: по смыслу для человека, а не по каждому статусу базы. */
const FILTERS: Array<{ key: string; label: string; status: string[] }> = [
  { key: 'all', label: msg('Все'), status: [] },
  { key: 'work', label: msg('В работе'), status: ['paid', 'delivered'] },
  { key: 'dispute', label: msg('Споры'), status: ['disputed'] },
  { key: 'done', label: msg('Завершены'), status: ['completed'] },
  { key: 'closed', label: msg('Возвраты и отмены'), status: ['refunded', 'cancelled', 'expired'] },
  { key: 'unpaid', label: msg('Ждут оплаты'), status: ['created'] },
];

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <Orders />
    </Suspense>
  );
}

function Orders() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const role = params.get('role') === 'seller' ? 'seller' : 'buyer';
  const filter = FILTERS.find((f) => f.key === params.get('f')) ?? FILTERS[0]!;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [toShip, setToShip] = useState(0);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/orders');
      return;
    }
    setRows(null);
    const qs = new URLSearchParams({ role, ...(filter.status.length ? { status: filter.status.join(',') } : {}) });
    apiFetch<Row[]>(`/orders/mine?${qs}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, [router, role, filter]);

  // Сколько продаж ждут выдачи — видно на вкладке, как счётчик на FunPay.
  useEffect(() => {
    if (!getToken()) return;
    apiFetch<Row[]>('/orders/mine?role=seller&status=paid')
      .then((r) => setToShip(r.length))
      .catch(() => {});
  }, []);

  const href = (r: string, f: string) => `/cabinet/orders?role=${r}${f !== 'all' ? `&f=${f}` : ''}`;

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>{t('Заказы')}</h1>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      <div className="stack-form" style={{ gap: 12 }}>
        <div className="row" role="tablist" aria-label={t('Покупки или продажи')} style={{ gap: 8 }}>
          <Link href={href('buyer', filter.key)} className="chip" role="tab" aria-selected={role === 'buyer'}
            aria-current={role === 'buyer' ? 'page' : undefined}>
            {t('Покупки')}
          </Link>
          <Link href={href('seller', filter.key)} className="chip" role="tab" aria-selected={role === 'seller'}
            aria-current={role === 'seller' ? 'page' : undefined}>
            {t('Продажи')}
            {toShip > 0 ? ` · ${t('{n} ждут выдачи', { n: toShip })}` : ''}
          </Link>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} aria-label={t('Статус')}>
          {FILTERS.map((f) => (
            <Link key={f.key} href={href(role, f.key)} className="chip" style={{ fontSize: 13, minHeight: 36 }}
              aria-current={f.key === filter.key ? 'page' : undefined}>
              {t(f.label)}
            </Link>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div aria-busy="true" aria-label={t('Загружаем заказы')}>
          <div className="skeleton" style={{ height: 72 }} />
          <div className="skeleton" style={{ height: 72, marginTop: 8 }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card flat row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span className="muted">
            {filter.key === 'all'
              ? role === 'buyer'
                ? t('Покупок пока нет. Деньги будут у площадки, пока вы не подтвердите получение.')
                : t('Продаж пока нет. Лот с понятным описанием и честной ценой продаётся быстрее.')
              : t('Заказов с таким статусом нет.')}
          </span>
          {filter.key === 'all' && (
            <Link href={role === 'buyer' ? '/catalog' : '/cabinet/new'} className="btn secondary">
              {role === 'buyer' ? t('В каталог') : t('Продать лот')}
            </Link>
          )}
        </div>
      ) : (
        // Таблицей, как «Покупки» и «Продажи» на FunPay: заказ, кто на той
        // стороне, статус, сумма — строки одной высоты читаются быстрее карточек.
        <div className="offers" style={{ ['--offer-cols' as string]: 'minmax(0, 1fr) minmax(120px, 180px) minmax(120px, 150px) minmax(96px, 120px)' }}>
          <div className="offer-head" aria-hidden>
            <span>{t('Заказ')}</span>
            <span>{role === 'buyer' ? t('Продавец') : t('Покупатель')}</span>
            <span>{t('Статус')}</span>
            <span className="num">{t('Сумма')}</span>
          </div>
          {rows.map((o) => {
            const ship = o.status === 'paid' && o.role === 'seller';
            const confirm = o.status === 'delivered' && o.role === 'buyer';
            return (
              <Link key={o.id} href={`/orders/${o.id}`} className="offer-row order-row">
                <span className="offer-desc">
                  <span className="offer-title">{o.title ?? o.publicNumber}</span>
                  <span className="offer-meta">
                    <span>
                      {o.unitName && (o.qty > 1 || o.unitName !== 'шт.') ? `${formatQty(o.qty, o.unitName, t)} · ` : ''} {/* i18n-ignore */}
                      {o.publicNumber} ·{' '}
                      {new Date(o.createdAt).toLocaleDateString(t.locale, { day: 'numeric', month: 'short' })}
                    </span>
                    {o.counterparty && (
                      <span className="only-mobile">
                        {o.role === 'buyer'
                          ? t('продавец {name}', { name: o.counterparty })
                          : t('покупатель {name}', { name: o.counterparty })}
                      </span>
                    )}
                  </span>
                </span>
                <span className="offer-attr">{o.counterparty ?? <span className="faint">—</span>}</span>
                <span className="order-status">
                  <span
                    className={
                      o.status === 'completed'
                        ? 'badge success'
                        : o.status === 'disputed'
                          ? 'badge warning'
                          : ship || confirm
                            ? 'badge accent'
                            : 'badge'
                    }
                  >
                    {ship
                      ? t('нужно выдать')
                      : confirm
                        ? t('подтвердите получение')
                        : STATUS[o.status]
                          ? t(STATUS[o.status]!)
                          : o.status}
                  </span>
                </span>
                <span className="offer-price num">
                  <span className="price">{formatPrice(o.amount, o.currency, t)}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
