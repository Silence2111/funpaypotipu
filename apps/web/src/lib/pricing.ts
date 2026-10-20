'use client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** То, что браузеру нужно из публичного прайса: курсы и способы оплаты шлюза. */
export interface PublicPricingLite {
  rates?: { USD: number; EUR: number } | null;
  /** Способы, которые принимает платёжный шлюз; у ЮKassa нет криптовалюты. */
  payMethods?: string[];
  paymentsDemo?: boolean;
}

let once: Promise<PublicPricingLite | null> | null = null;

/** Публичный прайс площадки — один запрос на страницу, сколько бы цен и форм на ней ни было. */
export function loadPublicPricing(): Promise<PublicPricingLite | null> {
  once ??= fetch(`${API_URL}/api/fees/public`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<PublicPricingLite>) : null))
    .catch(() => null);
  return once;
}
