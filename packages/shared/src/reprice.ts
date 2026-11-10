/**
 * Правка цен разом: выбранные лоты дороже или дешевле на столько-то
 * процентов — одна функция для превью в «Моих лотах» и для сервера.
 */

import type { Minor } from './money';

export const REPRICE_MIN_PCT = -50;
export const REPRICE_MAX_PCT = 100;

/**
 * Цена после правки на pct процентов. Цена в целых рублях остаётся в целых
 * рублях — 999 ₽ +7% это 1 069 ₽, а не 1 068,93 ₽; цена с копейками
 * (дешёвая пачка валюты) считается до копейки. Половина — вверх.
 */
export function repriced(price: Minor, pct: number): Minor {
  const kop = (price * BigInt(100 + pct) + 50n) / 100n;
  return price % 100n === 0n ? ((kop + 50n) / 100n) * 100n : kop;
}

/** Почему такой процент не подходит, или null. */
export function repriceError(pct: number): string | null {
  if (!Number.isInteger(pct) || pct === 0) return 'Укажите, на сколько процентов изменить цену';
  if (pct < REPRICE_MIN_PCT || pct > REPRICE_MAX_PCT) {
    return `Цену можно изменить от −${-REPRICE_MIN_PCT}% до +${REPRICE_MAX_PCT}%`;
  }
  return null;
}
