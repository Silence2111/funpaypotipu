'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
// Подпуть: подписи и ссылки те же, что в письмах и Telegram (shared/notify.ts).
import { NOTIFY_LABELS, notifyLink } from '@gamemarket/shared/notify';
import { apiFetch, getToken } from '@/lib/session';
import { useT } from '@/lib/i18n/client';
import { userText } from '@/lib/hidden';

interface Notif {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}


export function NotificationsBell() {
  const t = useT();
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
    const timer = setInterval(() => getToken() && load(), 30_000);
    // Прочитали на странице «Уведомления» — счётчик здесь тоже свежий.
    const onRead = () => void load();
    window.addEventListener('gm-notifications', onRead);
    return () => {
      clearInterval(timer);
      window.removeEventListener('gm-notifications', onRead);
    };
  }, [load]);

  const unread = items.filter((i) => !i.readAt).length;

  async function readAll() {
    await apiFetch('/notifications/read-all', { method: 'POST' }).catch(() => {});
    const now = new Date().toISOString();
    setItems((prev) => prev.map((i) => (i.readAt ? i : { ...i, readAt: now })));
  }

  async function markRead(id: string) {
    await apiFetch(`/notifications/${id}/read`, { method: 'POST' }).catch(() => {});
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i)));
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="chip" onClick={() => setOpen((o) => !o)} aria-label={t('Уведомления')} type="button">
        <Bell size={16} strokeWidth={1.75} />
        {unread > 0 && <span className="notif-badge">{unread}</span>}
      </button>
      {open && (
        <div className="notif-dropdown">
          {unread > 0 && (
            <button type="button" className="notif-readall" onClick={() => void readAll()}>
              {t('Прочитать все')}
            </button>
          )}
          {items.length === 0 && (
            <p className="muted" style={{ fontSize: 13, padding: 12, margin: 0 }}>{t('Уведомлений нет')}</p>
          )}
          {items.slice(0, 8).map((n) => (
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
              <span style={{ fontWeight: n.readAt ? 400 : 600 }}>{NOTIFY_LABELS[n.type] ? t.d(NOTIFY_LABELS[n.type]) : t('Уведомление')}</span>
              {typeof n.payload?.preview === 'string' && n.payload.preview && (
                <span className="faint" style={{ display: 'block', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {userText(t, n.payload.preview)}
                </span>
              )}
            </Link>
          ))}
          <div className="row notif-footer">
            <Link href="/cabinet/notifications" style={{ fontSize: 13, fontWeight: 600 }} onClick={() => setOpen(false)}>
              {t('Все уведомления')}
            </Link>
            <Link href="/cabinet/settings#notifications" className="faint" style={{ fontSize: 12 }} onClick={() => setOpen(false)}>
              {t('Настроить')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
