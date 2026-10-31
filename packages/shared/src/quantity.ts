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

/**
 * Скидка за количество — «оптом дешевле»: ступени «от 10 000 золота — 5%».
 * Действует ступень с наибольшим «от», не больше количества в заказе.
 * Скидка — от суммы за количество, вниз до копейки: её оплачивает продавец.
 */
export interface QtyTier {
  /** От скольки единиц. */
  from: number;
  /** Скидка, %. */
  pct: number;
}

export const QTY_TIERS_MAX = 3;
export const QTY_TIER_MIN_PCT = 1;
export const QTY_TIER_MAX_PCT = 50;

/** Ступени из JSON лота: только целые, по возрастанию «от». */
export function qtyTiers(raw: unknown): QtyTier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (x): x is QtyTier =>
        !!x &&
        typeof x === 'object' &&
        Number.isInteger((x as QtyTier).from) &&
        Number.isInteger((x as QtyTier).pct),
    )
    .map((x) => ({ from: x.from, pct: x.pct }))
    .sort((a, b) => a.from - b.from);
}

/**
 * Проверка ступеней продавца. Ступень от минимума за заказ — это просто
 * другая цена, а скидка, которая с количеством не растёт, сбивает с толку.
 */
export function qtyTiersError(tiers: QtyTier[], minQty: number): string | null {
  if (tiers.length > QTY_TIERS_MAX) return `Не больше ${QTY_TIERS_MAX} ступеней скидки`;
  for (const t of tiers) {
    if (!Number.isInteger(t.from) || t.from > QTY_MAX) return 'Укажите, от какого количества скидка';
    if (t.from <= minQty) return 'Скидка — от количества больше минимума за заказ';
    if (!Number.isInteger(t.pct) || t.pct < QTY_TIER_MIN_PCT || t.pct > QTY_TIER_MAX_PCT) {
      return `Скидка за количество — от ${QTY_TIER_MIN_PCT} до ${QTY_TIER_MAX_PCT}%`;
    }
  }
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i]!.from <= tiers[i - 1]!.from || tiers[i]!.pct <= tiers[i - 1]!.pct) {
      return 'Чем больше количество, тем больше скидка: ступени — по возрастанию';
    }
  }
  return null;
}

/** Ступень для этого количества или null. */
export function qtyTierFor(tiers: QtyTier[], qty: number): QtyTier | null {
  let hit: QtyTier | null = null;
  for (const t of tiers) if (qty >= t.from && (!hit || t.from > hit.from)) hit = t;
  return hit;
}

/** Следующая ступень — «возьмите ещё …, и скидка будет …». */
export function nextQtyTier(tiers: QtyTier[], qty: number): QtyTier | null {
  return tiers.filter((t) => t.from > qty).sort((a, b) => a.from - b.from)[0] ?? null;
}

/** Сумма за количество со скидкой: полная, скидка, итог и ступень. */
export function qtyPrice(
  price: Minor,
  pricePerUnits: number,
  qty: number,
  tiers: QtyTier[],
): { full: Minor; discount: Minor; total: Minor; tier: QtyTier | null } {
  const full = qtyTotal(price, pricePerUnits, qty);
  const tier = qtyTierFor(tiers, qty);
  const discount = tier ? (full * BigInt(tier.pct)) / 100n : 0n;
  return { full, discount, total: full - discount, tier };
}
