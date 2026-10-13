'use client';

import { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

/** Поднять лот в топ выдачи (кулдаун на бэке). */
export function BumpButton({ listingId, boostUntil }: { listingId: string; boostUntil?: string | null }) {
  const boosted = boostUntil ? new Date(boostUntil).getTime() > Date.now() : false;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(boosted ? 'в топе' : null);

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/listings/${listingId}/bump`, { method: 'POST' });
      setMsg('поднято');
    } catch (e) {
      // Раньше здесь показывались первые 40 символов сырого JSON ответа.
      setMsg(apiErrorMessage(e, 'нельзя'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="chip" type="button" onClick={go} disabled={busy}
      title="Поднять лот в топ" style={{ fontSize: 13 }}>
      <ArrowUp size={14} strokeWidth={2} /> {msg ?? 'Поднять'}
    </button>
  );
}
