'use client';

import { useEffect } from 'react';
import { apiFetch, useSession } from '@/lib/session';
import { forgetRef, saveRef, savedRef } from '@/lib/partner-ref';

/**
 * Ссылка партнёра `?ref=КОД` на любой странице: код запоминается, переход
 * считается один раз, параметр убирается из адреса — им не делятся дальше.
 * Вошёл — одна просьба привязать аккаунт, и код забыт; решает API.
 */
export function PartnerRef() {
  const { ready, user } = useSession();
  const userId = user?.id;

  useEffect(() => {
    const url = new URL(location.href);
    const ref = url.searchParams.get('ref');
    if (!ref) return;
    if (saveRef(ref)) {
      void apiFetch('/partners/click', {
        method: 'POST',
        body: JSON.stringify({ code: ref }),
      }).catch(() => {});
    }
    url.searchParams.delete('ref');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }, []);

  useEffect(() => {
    if (!ready || !userId) return;
    const code = savedRef();
    if (!code) return;
    void apiFetch('/partners/attach', { method: 'POST', body: JSON.stringify({ code }) })
      .catch(() => {})
      .finally(forgetRef);
  }, [ready, userId]);

  return null;
}
