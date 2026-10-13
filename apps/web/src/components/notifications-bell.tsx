'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
// Подпуть: подписи и ссылки те же, что в письмах и Telegram (shared/notify.ts).
import { NOTIFY_LABELS, notifyLink } from '@gamemarket/shared/notify';
import { apiFetch, getToken } from '@/lib/session';

interface Notif {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}


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
            // Уведомление ведёт туда, где действовать: заказ, чат, спор.
            <Link
              key={n.id}
              href={notifyLink(n.type, n.payload)}
              onClick={() => {
                void markRead(n.id);
                setOpen(false);
              }}
              className="notif-item"
              style={{ opacity: n.readAt ? 0.5 : 1, display: 'block' }}
            >
              <span style={{ fontWeight: n.readAt ? 400 : 600 }}>{NOTIFY_LABELS[n.type] ?? 'Уведомление'}</span>
              {typeof n.payload?.preview === 'string' && n.payload.preview && (
                <span className="faint" style={{ display: 'block', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.payload.preview}
                </span>
              )}
            </Link>
          ))}
          <Link href="/cabinet/settings#notifications" className="faint" style={{ display: 'block', fontSize: 12, padding: '8px 12px' }}
            onClick={() => setOpen(false)}>
            Настроить уведомления
          </Link>
        </div>
      )}
    </div>
  );
}
