'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { useT } from '@/lib/i18n/client';

interface Fav { id: string }

export function FavoriteButton({ listingId }: { listingId: string }) {
  const t = useT();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    apiFetch<Fav[]>('/favorites')
      .then((list) => setActive(list.some((l) => l.id === listingId)))
      .catch(() => {})
      .finally(() => setReady(true));
  }, [listingId]);

  async function toggle() {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    const next = !active;
    setActive(next);
    try {
      if (next) await apiFetch('/favorites', { method: 'POST', body: JSON.stringify({ listingId }) });
      else await apiFetch(`/favorites/${listingId}`, { method: 'DELETE' });
    } catch {
      setActive(!next); // откат
    }
  }

  return (
    <button
      className="chip"
      onClick={toggle}
      type="button"
      aria-label={t('В избранное')}
      style={{ opacity: ready ? 1 : 0.5 }}
    >
      <Heart size={16} strokeWidth={1.75} fill={active ? 'var(--danger)' : 'none'} color={active ? 'var(--danger)' : 'currentColor'} />
      {active ? t('В избранном') : t('В избранное')}
    </button>
  );
}
