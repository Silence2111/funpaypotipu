'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const KEY = 'gm_cur';

export type DisplayCurrency = 'RUB' | 'USD' | 'EUR';
export interface Rates { USD: number; EUR: number }

/** Выбранная валюта показа; оплата при этом всегда в рублях. */
export function getCurrency(): DisplayCurrency {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'USD' || v === 'EUR' ? v : 'RUB';
  } catch {
    return 'RUB';
  }
}

export function setCurrency(c: DisplayCurrency) {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* приватный режим — выбор живёт до перезагрузки */
  }
  window.dispatchEvent(new Event('gm-cur'));
}

let ratesOnce: Promise<Rates | null> | null = null;

/** Курсы площадки — один запрос на страницу, сколько бы цен на ней ни было. */
export function loadRates(): Promise<Rates | null> {
  ratesOnce ??= fetch(`${API_URL}/api/fees/public`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<{ rates?: Rates | null }>) : null))
    .then((p) => p?.rates ?? null)
    .catch(() => null);
  return ratesOnce;
}

export function useDisplayCurrency(): { currency: DisplayCurrency; rates: Rates | null } {
  const [state, setState] = useState<{ currency: DisplayCurrency; rates: Rates | null }>({ currency: 'RUB', rates: null });
  useEffect(() => {
    let alive = true;
    const sync = () => {
      const currency = getCurrency();
      if (currency === 'RUB') return setState((s) => ({ ...s, currency }));
      void loadRates().then((rates) => alive && setState({ currency, rates }));
    };
    sync();
    window.addEventListener('gm-cur', sync);
    window.addEventListener('storage', sync);
    return () => {
      alive = false;
      window.removeEventListener('gm-cur', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return state;
}

/** «≈ 10,84 $» из копеек по курсу площадки. */
export function approx(minor: string, currency: Exclude<DisplayCurrency, 'RUB'>, rates: Rates): string {
  const value = Number(BigInt(minor)) / 100 / rates[currency];
  return `≈ ${new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)}`;
}
