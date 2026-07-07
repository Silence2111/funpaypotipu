'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getToken, getUser } from '@/lib/session';
import { OrderChat } from '@/components/order-chat';

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const me = getUser();

  if (!getToken() || !me) {
    return (
      <div className="container" style={{ padding: 48 }}>
        <p className="muted">Войдите, чтобы открыть диалог.</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 720, paddingTop: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 className="h2">Диалог</h1>
        <Link href="/cabinet" className="chip">← Кабинет</Link>
      </div>
      <OrderChat conversationId={params.id} meId={me.id} />
    </div>
  );
}
