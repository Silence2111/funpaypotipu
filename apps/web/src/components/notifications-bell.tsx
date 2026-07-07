'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';

interface Notif {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

const LABELS: Record<string, string> = {
  order_created: 'Новый заказ по вашему лоту',
  order_paid: 'Заказ оплачен — выдайте товар',
  order_delivered: 'Товар выдан — подтвердите получение',
  order_completed: 'Сделка завершена, деньги зачислены',
  order_cancelled: 'Заказ отменён',
  order_refunded: 'Возврат по заказу',
  listing_out_of_stock: 'Закончились ключи по лоту — заказ возвращён',
  review_received: 'Новый отзыв',
  new_message: 'Новое сообщение',
  dispute_opened: 'Открыт спор по сделке',
  dispute_resolved: 'Спор разрешён',
  payout_paid: 'Выплата отправлена',
  payout_rejected: 'Выплата отклонена',
};

export function NotificationsBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await apiFetch<Notif[]>('/notifications'));
    } catch {
      /* не залогинен / сеть */
    }
  }, []);

  useEffect(() => {
    if (getToken()) load();
    const t = setInterval(() => getToken() && load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const unread = items.filter((i) => !i.readAt).length;

  async function markRead(id: string) {
    await apiFetch(`/notifications/${id}/read`, { method: 'POST' }).catch(() => {});
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i)));
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="chip" onClick={() => setOpen((o) => !o)} aria-label="Уведомления" type="button">
        <Bell size={16} strokeWidth={1.75} />
        {unread > 0 && <span className="notif-badge">{unread}</span>}
      </button>
      {open && (
        <div className="notif-dropdown">
          {items.length === 0 && (
            <p className="muted" style={{ fontSize: 13, padding: 12, margin: 0 }}>Уведомлений нет</p>
          )}
          {items.slice(0, 12).map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => markRead(n.id)}
              className="notif-item"
              style={{ opacity: n.readAt ? 0.5 : 1 }}
            >
              <span style={{ fontWeight: n.readAt ? 400 : 600 }}>{LABELS[n.type] ?? n.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
