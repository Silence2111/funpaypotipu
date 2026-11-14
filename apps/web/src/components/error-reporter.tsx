'use client';

import { useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
/** Не больше стольких сообщений со страницы: сломанный цикл не завалит сбор. */
const MAX_PER_PAGE = 5;
/** Шум, который не наша ошибка: расширения браузера, ResizeObserver, отмена загрузки. */
const NOISE =
  /ResizeObserver loop|chrome-extension:|moz-extension:|safari-extension:|AbortError|Script error\.?$/i;

/**
 * Ошибки страниц сайта — в сбор ошибок API (часть 130): у человека что-то
 * упало, а мы видим это в консоли «Сверка и сбои», а не узнаём из отзывов.
 * Адрес — без параметров и якоря: в них бывают коды и почты. Одинаковые
 * ошибки шлются один раз за страницу.
 */
export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const seen = new Set<string>();
    const report = (message: string, stack?: string) => {
      if (!message || NOISE.test(message) || (stack && NOISE.test(stack))) return;
      if (seen.has(message) || sent >= MAX_PER_PAGE) return;
      seen.add(message);
      sent++;
      void fetch(`${API_URL}/api/ops/client-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.slice(0, 1000),
          stack: stack?.slice(0, 8000),
          path: window.location.pathname.slice(0, 300),
        }),
        keepalive: true,
      }).catch(() => {});
    };
    const onError = (e: ErrorEvent) => {
      if (e.filename && !e.filename.startsWith(window.location.origin)) return;
      report(e.message, e.error instanceof Error ? e.error.stack : undefined);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      report(
        r instanceof Error ? `${r.name}: ${r.message}` : String(r),
        r instanceof Error ? r.stack : undefined,
      );
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
