'use client';

import { useEffect } from 'react';

/**
 * Сервис-воркер нужен для одного: без сети показать «Нет соединения», а не
 * пустой экран браузера. В разработке не ставится — горячая перезагрузка и
 * воркер мешали бы друг другу.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
