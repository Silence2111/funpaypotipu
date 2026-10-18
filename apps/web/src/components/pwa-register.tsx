'use client';

import { useEffect } from 'react';
import { useSession } from '@/lib/session';
import { keepPushOwner } from '@/lib/push';

/**
 * Сервис-воркер: без сети показать «Нет соединения», а не пустой экран
 * браузера, и показывать пуши. В разработке сам не ставится — горячая
 * перезагрузка и воркер мешали бы друг другу; пуши ставят его по нажатию.
 *
 * Здесь же — пуши этого браузера: они остаются, только пока вошёл тот, кто
 * их включил (keepPushOwner).
 */
export function PwaRegister() {
  const { ready, user } = useSession();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  useEffect(() => {
    if (ready) keepPushOwner(userId).catch(() => {});
  }, [ready, userId]);

  return null;
}
