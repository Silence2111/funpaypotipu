'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';

/** Предпродажный чат: открыть/создать диалог с продавцом лота. */
export function MessageSellerButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    setBusy(true);
    try {
      const c = await apiFetch<{ id: string }>(`/conversations/for-listing/${listingId}`, {
        method: 'POST',
      });
      router.push(`/chat/${c.id}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button className="chip" onClick={go} disabled={busy} type="button">
      <MessagesSquare size={16} strokeWidth={1.75} />
      {busy ? '…' : 'Написать продавцу'}
    </button>
  );
}
