/**
 * Продажа поштучно — как игровая валюта и предметы на FunPay.
 *
 * Лот с единицей измерения («золото», «шт.») продаётся количеством: цена
 * указана за пачку единиц («15 ₽ за 1000 золота»), у лота есть наличие и
 * минимум за заказ. Пачка нужна для дешёвых валют: цена одной единицы
 * бывает меньше копейки, а деньги здесь — только целые копейки.
 *
 * Сумма считается в bigint и округляется вверх до копейки — так же, как
 * наценка пополнения (`topup.ts`): одна функция для витрины и для заказа.
 */

import type { Minor } from './money';

/** Сколько единиц можно купить за раз — защита от переполнения и опечаток. */
export const QTY_MAX = 1_000_000_000;

/** Допустимые размеры пачки, за которую указана цена. */
export const PRICE_PER_UNITS = [1, 10, 100, 1000, 10_000, 100_000, 1_000_000] as const;

export interface QtyTerms {
  /** Единица: «золото», «шт.». null — обычный лот, продаётся целиком. */
  unitName: string | null;
  /** Цена лота указана за столько единиц. */
  pricePerUnits: number;
  /** Минимум единиц в заказе. */
  minQty: number;
  /** Наличие в единицах; null — без ограничения. */
  stock: number | null;
}

/** Сумма за qty единиц при цене `price` за `pricePerUnits` единиц, вверх до копейки. */
export function qtyTotal(price: Minor, pricePerUnits: number, qty: number): Minor {
  const per = BigInt(pricePerUnits);
  return (price * BigInt(qty) + per - 1n) / per;
}

const n = (v: number) => new Intl.NumberFormat('ru-RU').format(v);

/** Почему столько купить нельзя, или null. */
export function qtyError(qty: number, terms: Pick<QtyTerms, 'unitName' | 'minQty' | 'stock'>): string | null {
  const unit = terms.unitName ?? 'шт.';
  if (!Number.isInteger(qty) || qty < 1) return 'Укажите количество';
  if (qty > QTY_MAX) return 'Слишком большое количество';
  if (terms.stock != null && qty > terms.stock) {
    return terms.stock > 0 ? `В наличии только ${n(terms.stock)} ${unit}` : 'Лот закончился';
  }
  if (qty < terms.minQty) return `Минимум — ${n(terms.minQty)} ${unit}`;
  return null;
}

/** Проверка условий, которые задаёт продавец. null — условия годятся. */
export function qtyTermsError(terms: QtyTerms): string | null {
  const unit = terms.unitName?.trim() ?? '';
  if (!unit) return 'Укажите единицу: например, «золото» или «шт.»';
  if (unit.length > 24) return 'Единица — не длиннее 24 символов';
  if (!(PRICE_PER_UNITS as readonly number[]).includes(terms.pricePerUnits)) {
    return 'Цену можно указать за 1, 10, 100, 1 000, 10 000, 100 000 или 1 000 000 единиц';
  }
  if (!Number.isInteger(terms.minQty) || terms.minQty < 1) return 'Минимум за заказ — от 1';
  if (terms.minQty > QTY_MAX) return 'Слишком большой минимум';
  if (terms.stock == null) return 'Укажите наличие';
  if (!Number.isInteger(terms.stock) || terms.stock < 0) return 'Наличие — целое число, от нуля';
  return null;
}

/** Покупает ли покупатель этот лот количеством. */
export const soldByQty = (l: { unitName: string | null; fulfillmentType: string }): boolean =>
  l.unitName != null || l.fulfillmentType === 'auto_key';
