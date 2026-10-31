'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { Empty, when } from './shared';

interface Row {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  messages: number;
  buyer: string | null;
  seller: string | null;
  arbiter: string | null;
  awaitingFrom: 'buyer' | 'seller' | null;
  respondBy: string | null;
  missedBy: 'buyer' | 'seller' | null;
  order: { publicNumber: string; amount: string; currency: string; title: string | null } | null;
}

const WHO = { buyer: 'покупатель', seller: 'продавец' } as const;
const WHOM = { buyer: 'покупателя', seller: 'продавца' } as const;

/**
 * Очередь споров: сумма, стороны, кто взял, чей ход. Кто пропустил срок
 * ответа — наверху: такой спор можно решать по тому, что есть.
 */
export function DisputesSection() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    apiFetch<Row[]>('/disputes/queue').then(setRows).catch(() => setRows([]));
  }, []);

  if (rows === null) return <div className="skeleton" style={{ height: 120 }} aria-busy="true" />;
  if (!rows.length) return <Empty>Открытых споров нет.</Empty>;

  return (
    <section className="grid" style={{ gap: 8 }}>
      {rows.map((d) => (
        <Link key={d.id} href={`/disputes/${d.id}`} className="card link" style={{ padding: 18, display: 'block' }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{d.order?.title ?? d.order?.publicNumber ?? 'Заказ'}</span>
            {d.order && <span className="price" style={{ fontSize: 15 }}>{formatPrice(d.order.amount, d.order.currency)}</span>}
          </div>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>{d.reason}</p>
          <div className="row faint" style={{ gap: 8, marginTop: 8, fontSize: 13, flexWrap: 'wrap' }}>
            <span className={d.status === 'open' ? 'badge accent' : 'badge'}>
              {d.status === 'open' ? 'ждёт арбитра' : `в работе${d.arbiter ? ` · ${d.arbiter}` : ''}`}
            </span>
            {d.missedBy && <span className="badge warning">{WHO[d.missedBy]} не ответил в срок</span>}
            {d.awaitingFrom && d.respondBy && (
              <span className="badge">ждём {WHOM[d.awaitingFrom]} до {when(d.respondBy)}</span>
            )}
            <span>покупатель {d.buyer ?? '—'} · продавец {d.seller ?? '—'}</span>
            <span>· открыт {when(d.createdAt)} · сообщений: {d.messages}</span>
          </div>
        </Link>
      ))}
    </section>
  );
}
