'use client';

import { useEffect } from 'react';
import { apiFetch } from '@/lib/session';

/**
 * Отметка просмотра лота для статистики продавца: раз в сутки с браузера.
 * Без JavaScript (роботы) просмотр не считается; сбой отметки ничего не
 * ломает — страница её не ждёт.
 */
export function ViewBeacon({ listingId }: { listingId: string }) {
  useEffect(() => {
    const key = `gm_viewed_${listingId}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
    } catch {
      // Приватный режим без хранилища — просто отметим.
    }
    apiFetch(`/lot-stats/${listingId}/view`, { method: 'POST' }).catch(() => {});
  }, [listingId]);
  return null;
}
