'use client';

import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import { apiFetch, useSession } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

/**
 * «В чёрный список» на витрине продавца: он не сможет писать вам до
 * сделки и покупать ваши лоты, вы — у него. Уже оплаченные заказы
 * доводятся как обычно.
 */
export function BlockButton({ userId, username }: { userId: string; username: string }) {
  const { ready, user } = useSession();
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user || user.id === userId) return;
    apiFetch<Array<{ userId: string }>>('/account/blocks')
      .then((rows) => setBlocked(rows.some((r) => r.userId === userId)))
      .catch(() => setBlocked(null));
  }, [user, userId]);

  if (!ready || !user || user.id === userId || blocked === null) return null;

  async function toggle() {
    if (!blocked && !window.confirm(`Добавить ${username} в чёрный список? Он не сможет писать вам до сделки и покупать ваши лоты.`)) return;
    setBusy(true);
    setErr(null);
    try {
      if (blocked) await apiFetch(`/account/blocks/${userId}`, { method: 'DELETE' });
      else await apiFetch('/account/blocks', { method: 'POST', body: JSON.stringify({ userId }) });
      setBlocked(!blocked);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не получилось. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="chip" disabled={busy} onClick={() => void toggle()} aria-pressed={blocked}>
        <Ban size={15} strokeWidth={1.75} /> {blocked ? 'В чёрном списке' : 'В чёрный список'}
      </button>
      {err && <p className="field-error" role="alert" style={{ flexBasis: '100%', margin: 0 }}>{err}</p>}
    </>
  );
}
