'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MessagesSquare } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';

interface Conv { id: string; orderId: string | null; lastMessageAt: string | null; unread?: number }

export default function ChatsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Conv[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    apiFetch<Conv[]>('/conversations')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div className="container" style={{ padding: 48 }} />;

  return (
    <div className="container" style={{ paddingTop: 48, maxWidth: 640 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className="h1" style={{ fontSize: 30 }}>Диалоги</h1>
        <Link href="/cabinet" className="chip">← Кабинет</Link>
      </div>
      {items.length ? (
        <div className="grid" style={{ gap: 8 }}>
          {items.map((c) => (
            <Link key={c.id} href={`/chat/${c.id}`} className="card link row"
              style={{ justifyContent: 'space-between', padding: 16 }}>
              <span className="row" style={{ gap: 10 }}>
                <MessagesSquare size={18} strokeWidth={1.75} />
                {c.orderId ? 'Диалог по сделке' : 'Предпродажный диалог'}
                {!!c.unread && <span className="notif-badge">{c.unread}</span>}
              </span>
              {c.lastMessageAt && (
                <span className="faint" style={{ fontSize: 12 }}>
                  {new Date(c.lastMessageAt).toLocaleDateString('ru-RU')}
                </span>
              )}
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">Диалогов пока нет.</p>
      )}
    </div>
  );
}
