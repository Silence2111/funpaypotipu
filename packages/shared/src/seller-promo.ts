/**
 * Промокод продавца: скидка за его счёт. Цена снижается до расчёта
 * комиссии — площадка берёт её с того, что заплатил покупатель. Один раз
 * на покупателя; отменённый заказ использование возвращает.
 */

export const SELLER_PROMO_MIN_PCT = 5;
export const SELLER_PROMO_MAX_PCT = 50;
export const MAX_SELLER_PROMOS = 20;

/** Код: латиница и цифры, 4–20 знаков, хранится в верхнем регистре. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function promoCodeError(code: string): string | null {
  return /^[A-Z0-9]{4,20}$/.test(code) ? null : 'Код — 4–20 латинских букв и цифр';
}

/** Скидка в копейках — до копейки вниз, в пользу продавца. */
export function sellerPromoDiscount(base: bigint, percent: number): bigint {
  return (base * BigInt(percent)) / 100n;
}
