'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './session';

/** Ответ `GET /account/summary` — счётчики шапки и нижней панели. */
export interface Summary {
  unreadMessages: number;
  unreadNotifications: number;
  balance: { currency: string; available: string };
  sales: { toDeliver: number };
  purchases: { toConfirm: number };
  /** Спор, где ждут вашего ответа, — с самым близким сроком. */
  dispute: { id: string; orderNumber: string; respondBy: string } | null;
}

/**
 * Одна сводка на страницу: шапка и нижняя панель на телефоне показывают одни
 * и те же счётчики и не опрашивают сервер каждая по-своему. Обновляется раз
 * в полминуты, при возврате на вкладку, при прочтении сообщений (`gm-unread`)
 * и при переходе — но не чаще раза в секунду.
 */
let current: Summary | null = null;
let last = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(s: Summary | null) => void>();

export function refreshSummary(force = false): void {
  if (!force && Date.now() - last < 1000) return;
  last = Date.now();
  apiFetch<Summary>('/account/summary')
    .then((s) => {
      current = s;
      listeners.forEach((l) => l(s));
    })
    .catch(() => {});
}

const onEvent = () => refreshSummary(true);

export function useSummary(enabled: boolean, path?: string): Summary | null {
  const [sum, setSum] = useState<Summary | null>(enabled ? current : null);

  useEffect(() => {
    if (!enabled) {
      setSum(null);
      return;
    }
    listeners.add(setSum);
    setSum(current);
    if (listeners.size === 1) {
      timer = setInterval(onEvent, 30_000);
      window.addEventListener('focus', onEvent);
      window.addEventListener('gm-unread', onEvent);
    }
    return () => {
      listeners.delete(setSum);
      if (listeners.size === 0) {
        if (timer) clearInterval(timer);
        timer = null;
        window.removeEventListener('focus', onEvent);
        window.removeEventListener('gm-unread', onEvent);
        current = null;
      }
    };
  }, [enabled]);

  // Прочитал диалог, оплатил, выдал — счётчики свежие после перехода.
  useEffect(() => {
    if (enabled) refreshSummary();
  }, [enabled, path]);

  return sum;
}
