'use client';

import { useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

/** Поднять лот в топ выдачи (кулдаун на бэке). */
export function BumpButton({ listingId, boostUntil }: { listingId: string; boostUntil?: string | null }) {
  const t = useT();
  const boosted = boostUntil ? new Date(boostUntil).getTime() > Date.now() : false;
  const [busy, setBusy] = useState(false);
  // Состояние, а не готовая подпись: подпись берётся на текущем языке сайта.
  const [state, setState] = useState<'top' | 'bumped' | null>(boosted ? 'top' : null);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setState(null);
    setErr(null);
    try {
      await apiFetch(`/listings/${listingId}/bump`, { method: 'POST' });
      setState('bumped');
    } catch (e) {
      // Раньше здесь показывались первые 40 символов сырого JSON ответа.
      setErr(apiErrorMessage(e, t('нельзя')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="chip" type="button" onClick={go} disabled={busy}
      title={t('Поднять лот в топ')} style={{ fontSize: 13 }}>
      <ArrowUp size={14} strokeWidth={2} />{' '}
      {err ?? (state === 'top' ? t('в топе') : state === 'bumped' ? t('поднято') : t('Поднять'))}
    </button>
  );
}
