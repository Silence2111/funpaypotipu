'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ShieldCheck, KeyRound } from 'lucide-react';
import { apiFetch, getToken, getUser } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { OrderChat } from '@/components/order-chat';

interface Order {
  id: string; publicNumber: string; status: string; amount: string; currency: string;
  buyerId: string; sellerId: string; fulfillmentType: string;
}
interface Conversation { id: string; orderId: string | null }

const STATUS_RU: Record<string, string> = {
  created: 'создан', paid: 'оплачен (в эскроу)', delivered: 'выдан', completed: 'завершён',
  disputed: 'спор', refunded: 'возврат', cancelled: 'отменён', expired: 'истёк',
};

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [order, setOrder] = useState<Order | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const me = getUser();

  const loadOrder = useCallback(async () => {
    setOrder(await apiFetch<Order>(`/orders/${id}`));
  }, [id]);

  const loadConv = useCallback(async () => {
    const convs = await apiFetch<Conversation[]>('/conversations').catch(() => []);
    setConv(convs.find((x) => x.orderId === id) ?? null);
  }, [id]);

  useEffect(() => {
    if (!getToken()) return;
    loadOrder().catch(() => setErr('Заказ не найден'));
    loadConv();
  }, [loadOrder, loadConv]);

  async function act(path: string) {
    setErr(null);
    try {
      await apiFetch(`/orders/${id}/${path}`, { method: 'POST' });
      await loadOrder();
    } catch {
      setErr('Действие недоступно');
    }
  }

  async function revealKey() {
    try {
      const r = await apiFetch<{ key: string }>(`/orders/${id}/key`);
      setKey(r.key);
    } catch {
      setErr('Ключ ещё не выдан');
    }
  }

  if (!getToken())
    return (
      <div className="container" style={{ padding: 48 }}>
        <p className="muted">Войдите, чтобы увидеть заказ.</p>
      </div>
    );
  if (!order) return <div className="container" style={{ padding: 48 }}>{err ?? ''}</div>;

  const role = me?.id === order.buyerId ? 'buyer' : 'seller';

  return (
    <div className="container" style={{ paddingTop: 48, maxWidth: 720 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 className="h2">Заказ #{order.publicNumber}</h1>
        <span className="badge">{STATUS_RU[order.status] ?? order.status}</span>
      </div>
      <div className="price" style={{ fontSize: 26, margin: '12px 0 20px' }}>
        {formatPrice(order.amount, order.currency)}
      </div>

      <div className="row faint" style={{ gap: 6, fontSize: 13, marginBottom: 20 }}>
        <ShieldCheck size={15} strokeWidth={1.75} /> Оплата удерживается эскроу до подтверждения
      </div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        {role === 'seller' && order.status === 'paid' && (
          <button className="btn" onClick={() => act('deliver')} type="button">Отметить выдачу</button>
        )}
        {role === 'buyer' && order.status === 'delivered' && (
          <button className="btn" onClick={() => act('confirm')} type="button">Подтвердить получение</button>
        )}
        {role === 'buyer' && order.fulfillmentType === 'auto_key' &&
          (order.status === 'delivered' || order.status === 'completed') && (
            <button className="btn ghost" onClick={revealKey} type="button">
              <KeyRound size={16} /> Показать ключ
            </button>
          )}
        {(order.status === 'paid' || order.status === 'delivered') && (
          <button className="chip" onClick={() => act('cancel')} type="button">Отменить / возврат</button>
        )}
      </div>

      {key && <div className="card" style={{ marginTop: 16, fontFamily: 'monospace' }}>{key}</div>}
      {err && <p style={{ color: '#d33', fontSize: 14 }}>{err}</p>}

      <section style={{ marginTop: 40 }}>
        <h2 className="h2" style={{ fontSize: 18, marginBottom: 16 }}>Чат по сделке</h2>
        {conv && me ? (
          <OrderChat conversationId={conv.id} meId={me.id} />
        ) : (
          <p className="muted" style={{ fontSize: 14 }}>Диалог появится после оформления заказа.</p>
        )}
      </section>
    </div>
  );
}
