'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

/** Страница списка консоли: строки, с чего продолжать и счётчики фильтров. */
export interface Paged<T, C> {
  items: T[];
  /** С какой строки продолжать «Показать ещё»; null — показаны все. */
  next: string | null;
  /** Сколько в каждом фильтре; в поиске — найденных. */
  counts: C;
}

/**
 * Список консоли по 50 с «Показать ещё». `path` — запрос первой страницы с
 * фильтрами; сменился — список грузится заново, а ответ на прежний фильтр
 * новый список не перетирает. `head` — первая страница целиком: в ней бывают
 * поля помимо строк.
 */
export function usePaged<T extends { id: string }, C, P extends Paged<T, C> = Paged<T, C>>(path: string, fallback: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [counts, setCounts] = useState<C | null>(null);
  const [head, setHead] = useState<P | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const current = useRef('');

  useEffect(() => {
    current.current = path;
    setRows(null);
    setErr(null);
    apiFetch<P>(path)
      .then((p) => {
        if (current.current !== path) return;
        setRows(p.items);
        setNext(p.next);
        setCounts(p.counts);
        setHead(p);
      })
      .catch((e) => {
        if (current.current !== path) return;
        setRows([]);
        setNext(null);
        setErr(apiErrorMessage(e, fallback));
      });
  }, [path, fallback]);

  async function more() {
    if (!next || busy) return;
    const key = current.current;
    setBusy(true);
    setErr(null);
    try {
      const p = await apiFetch<P>(`${key}${key.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(next)}`);
      if (current.current !== key) return;
      setRows((prev) => {
        const seen = new Set((prev ?? []).map((x) => x.id));
        return [...(prev ?? []), ...p.items.filter((x) => !seen.has(x.id))];
      });
      setNext(p.next);
      setCounts(p.counts);
    } catch (e) {
      setErr(apiErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  return { rows, setRows, next, counts, setCounts, head, busy, err, setErr, more };
}
