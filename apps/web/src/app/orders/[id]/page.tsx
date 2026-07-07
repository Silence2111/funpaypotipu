'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ShieldCheck, KeyRound, Star, AlertTriangle } from 'lucide-react';
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
  const [busy, setBusy] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [reason, setReason] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [reviewDone, setReviewDone] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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
    setBusy(true);
    try {
      await apiFetch(`/orders/${id}/${path}`, { method: 'POST' });
      await loadOrder();
    } catch {
      setErr('Действие недоступно');
    } finally {
      setBusy(false);
    }
  }

  async function openDispute() {
    if (reason.trim().length < 3) {
      setErr('Опишите проблему подробнее');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await apiFetch('/disputes', {
        method: 'POST',
        body: JSON.stringify({ orderId: id, reason: reason.trim() }),
      });
      setShowDispute(false);
      setReason('');
      await loadOrder();
    } catch {
      setErr('Не удалось открыть спор');
    } finally {
      setBusy(false);
    }
  }

  async function submitReview() {
    if (rating < 1) {
      setErr('Поставьте оценку');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await apiFetch('/reviews', {
        method: 'POST',
        body: JSON.stringify({ orderId: id, rating, comment: comment.trim() || undefined }),
      });
      setReviewDone(true);
    } catch {
      setNote('Отзыв по этому заказу уже оставлен.');
      setReviewDone(true);
    } finally {
      setBusy(false);
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
        {role === 'buyer' && order.status === 'created' && (
          <button className="btn" onClick={() => act('pay-from-balance')} disabled={busy} type="button">
            Оплатить с баланса
          </button>
        )}
        {role === 'seller' && order.status === 'paid' && (
          <button className="btn" onClick={() => act('deliver')} disabled={busy} type="button">Отметить выдачу</button>
        )}
        {role === 'buyer' && order.status === 'delivered' && (
          <button className="btn" onClick={() => act('confirm')} disabled={busy} type="button">Подтвердить получение</button>
        )}
        {role === 'buyer' && order.fulfillmentType === 'auto_key' &&
          (order.status === 'delivered' || order.status === 'completed') && (
            <button className="btn ghost" onClick={revealKey} type="button">
              <KeyRound size={16} /> Показать ключ
            </button>
          )}
        {role === 'buyer' && (order.status === 'paid' || order.status === 'delivered') && (
          <button className="chip" onClick={() => setShowDispute((v) => !v)} type="button">
            <AlertTriangle size={14} strokeWidth={1.75} /> Открыть спор
          </button>
        )}
        {(order.status === 'paid' || order.status === 'delivered') && (
          <button className="chip" onClick={() => act('cancel')} disabled={busy} type="button">Отменить / возврат</button>
        )}
      </div>

      {showDispute && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="faint" style={{ fontSize: 13, marginBottom: 8 }}>
            Опишите проблему — спор рассмотрит арбитр площадки
          </div>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Что пошло не так?" style={{ resize: 'vertical' }} />
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn" onClick={openDispute} disabled={busy} type="button">Отправить</button>
            <button className="chip" onClick={() => setShowDispute(false)} type="button">Отмена</button>
          </div>
        </div>
      )}

      {order.status === 'disputed' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ gap: 8, fontSize: 14 }}>
            <AlertTriangle size={16} strokeWidth={1.75} /> По заказу открыт спор — ожидайте решения арбитра.
            Общайтесь в чате сделки ниже.
          </div>
        </div>
      )}

      {role === 'buyer' && order.status === 'completed' && !reviewDone && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="faint" style={{ fontSize: 13, marginBottom: 8 }}>Оцените продавца</div>
          <div className="row" style={{ gap: 4 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)}
                style={{ background: 'none', border: 0, cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                <Star size={24} strokeWidth={1.75}
                  fill={n <= rating ? '#f5a623' : 'none'} color={n <= rating ? '#f5a623' : 'var(--fg-faint)'} />
              </button>
            ))}
          </div>
          <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Комментарий (необязательно)" style={{ resize: 'vertical', marginTop: 10 }} />
          <button className="btn" onClick={submitReview} disabled={busy} type="button" style={{ marginTop: 10 }}>
            Оставить отзыв
          </button>
        </div>
      )}
      {reviewDone && <p className="muted" style={{ fontSize: 14, marginTop: 12 }}>{note ?? 'Спасибо за отзыв!'}</p>}

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
