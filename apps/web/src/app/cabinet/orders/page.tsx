'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { formatPrice, formatQty } from '@/lib/format';
import { CabinetNav } from '@/components/cabinet-nav';

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

const STATUS_RU: Record<string, string> = {
  created: 'ждёт оплаты',
  paid: 'оплачен',
  delivered: 'выдан',
  completed: 'завершён',
  disputed: 'спор',
  refunded: 'возврат',
  cancelled: 'отменён',
  expired: 'истёк',
};

/** Фильтры как на FunPay: по смыслу для человека, а не по каждому статусу базы. */
const FILTERS: Array<{ key: string; label: string; status: string[] }> = [
  { key: 'all', label: 'Все', status: [] },
  { key: 'work', label: 'В работе', status: ['paid', 'delivered'] },
  { key: 'dispute', label: 'Споры', status: ['disputed'] },
  { key: 'done', label: 'Завершены', status: ['completed'] },
  { key: 'closed', label: 'Возвраты и отмены', status: ['refunded', 'cancelled', 'expired'] },
  { key: 'unpaid', label: 'Ждут оплаты', status: ['created'] },
];

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <Orders />
    </Suspense>
  );
}

function Orders() {
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
        <h1 className="h1" style={{ fontSize: 32 }}>Заказы</h1>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      <div className="stack-form" style={{ gap: 12 }}>
        <div className="row" role="tablist" aria-label="Покупки или продажи" style={{ gap: 8 }}>
          <Link href={href('buyer', filter.key)} className="chip" role="tab" aria-selected={role === 'buyer'}
            aria-current={role === 'buyer' ? 'page' : undefined}>
            Покупки
          </Link>
          <Link href={href('seller', filter.key)} className="chip" role="tab" aria-selected={role === 'seller'}
            aria-current={role === 'seller' ? 'page' : undefined}>
            Продажи{toShip > 0 ? ` · ${toShip} ждут выдачи` : ''}
          </Link>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} aria-label="Статус">
          {FILTERS.map((f) => (
            <Link key={f.key} href={href(role, f.key)} className="chip" style={{ fontSize: 13, minHeight: 36 }}
              aria-current={f.key === filter.key ? 'page' : undefined}>
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div aria-busy="true" aria-label="Загружаем заказы">
          <div className="skeleton" style={{ height: 72 }} />
          <div className="skeleton" style={{ height: 72, marginTop: 8 }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card flat row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span className="muted">
            {filter.key === 'all'
              ? role === 'buyer'
                ? 'Покупок пока нет. Деньги будут у площадки, пока вы не подтвердите получение.'
                : 'Продаж пока нет. Лот с понятным описанием и честной ценой продаётся быстрее.'
              : 'Заказов с таким статусом нет.'}
          </span>
          {filter.key === 'all' && (
            <Link href={role === 'buyer' ? '/catalog' : '/cabinet/new'} className="btn secondary">
              {role === 'buyer' ? 'В каталог' : 'Продать лот'}
            </Link>
          )}
        </div>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="card link row"
              style={{ justifyContent: 'space-between', padding: 16, gap: 12, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 200 }}>
                <span style={{ fontWeight: 600, display: 'block' }}>{o.title ?? o.publicNumber}</span>
                <span className="faint" style={{ fontSize: 13 }}>
                  {o.unitName && (o.qty > 1 || o.unitName !== 'шт.') ? `${formatQty(o.qty, o.unitName)} · ` : ''}
                  {o.publicNumber} ·{' '}
                  {new Date(o.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  {o.counterparty ? ` · ${o.role === 'buyer' ? 'продавец' : 'покупатель'} ${o.counterparty}` : ''}
                </span>
              </span>
              <span className="row" style={{ gap: 12 }}>
                <span className="price">{formatPrice(o.amount, o.currency)}</span>
                <span
                  className={
                    o.status === 'completed'
                      ? 'badge success'
                      : o.status === 'disputed'
                        ? 'badge warning'
                        : o.status === 'paid' && o.role === 'seller'
                          ? 'badge accent'
                          : 'badge'
                  }
                >
                  {o.status === 'paid' && o.role === 'seller' ? 'нужно выдать' : STATUS_RU[o.status] ?? o.status}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
