import type { MouseEvent } from 'react';

/** Параметры адреса: пустая строка, null и false в адрес не попадают. */
export type QueryParams = Record<string, string | null | undefined | false>;

/** Адрес страницы с параметрами: `/cabinet/orders?role=seller&days=30`. */
export function withQuery(pathname: string, params: QueryParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/**
 * Сменить адрес, не уходя со страницы. Фильтры кабинета живут в адресе, чтобы
 * ссылкой и «Назад» возвращаться к тому же списку. `router.replace` в Next.js
 * на каждое переключение запрашивает страницу у сервера, а
 * `history.replaceState` — нет; `useSearchParams` Next.js обновляет сам.
 */
export function replaceUrl(url: string): void {
  if (url === window.location.pathname + window.location.search) return;
  window.history.replaceState(null, '', url);
}

/**
 * Параметры из `useSearchParams` — всё ещё текущий адрес? При быстрых
 * переключениях страница может получить промежуточный адрес уже после
 * следующего выбора — такой не должен откатывать выбор назад.
 */
export function isCurrentQuery(params: { toString(): string }): boolean {
  return params.toString() === new URLSearchParams(window.location.search).toString();
}

/** Обычный клик по ссылке-фильтру: с Ctrl, Cmd, Shift или колёсиком — открыть как ссылку. */
export function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
