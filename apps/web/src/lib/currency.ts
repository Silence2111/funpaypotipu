'use client';

import { useEffect, useState } from 'react';
import { loadPublicPricing } from './pricing';

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

/** Курсы площадки — из того же одного запроса прайса на страницу. */
export function loadRates(): Promise<Rates | null> {
  return loadPublicPricing().then((p) => p?.rates ?? null);
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

/** «≈ 10,84 $» из копеек по курсу площадки; по-английски — «≈ $10.84». */
export function approx(
  minor: string,
  currency: Exclude<DisplayCurrency, 'RUB'>,
  rates: Rates,
  locale = 'ru-RU',
): string {
  const value = Number(BigInt(minor)) / 100 / rates[currency];
  return `≈ ${new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)}`;
}
