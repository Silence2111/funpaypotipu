'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessagesSquare } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

/**
 * Предпродажный чат: открыть/создать диалог с продавцом лота. Отказ
 * (свой лот, чёрный список) объясняется, а не глотается молча.
 */
export function MessageSellerButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (!getToken()) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const c = await apiFetch<{ id: string }>(`/conversations/for-listing/${listingId}`, {
        method: 'POST',
      });
      router.push(`/chat/${c.id}`);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось открыть диалог. Попробуйте ещё раз.'));
      setBusy(false);
    }
  }

  return (
    <>
      <button className="chip" onClick={go} disabled={busy} type="button">
        <MessagesSquare size={16} strokeWidth={1.75} />
        {busy ? '…' : 'Написать продавцу'}
      </button>
      {err && (
        <p className="field-error" role="alert" style={{ flexBasis: '100%', margin: 0 }}>
          {err}
        </p>
      )}
    </>
  );
}
