import { describe, it, expect } from 'vitest';
import {
  nextQtyTier,
  qtyError,
  qtyPrice,
  qtyTermsError,
  qtyTiers,
  qtyTiersError,
  qtyTotal,
  soldByQty,
} from './quantity';

/**
 * Продажа поштучно: сумма за количество и границы заказа. Ошибка здесь —
 * лишняя или недостающая копейка в каждой сделке с валютой.
 */

describe('сумма за количество', () => {
  it('15 ₽ за 1000 золота: 25 000 золота стоят 375 ₽', () => {
    expect(qtyTotal(1_500n, 1000, 25_000)).toBe(37_500n);
  });

  it('цена за штуку: 3 шт. по 120 ₽ — 360 ₽', () => {
    expect(qtyTotal(12_000n, 1, 3)).toBe(36_000n);
  });

  it('обычный лот (1 шт. за 1) стоит свою цену', () => {
    expect(qtyTotal(99_900n, 1, 1)).toBe(99_900n);
  });

  it('дробная копейка округляется вверх', () => {
    // 3 коп. за 1000 серебра: 1 500 серебра = 4,5 коп. → 5 коп.
    expect(qtyTotal(3n, 1000, 1500)).toBe(5n);
  });

  it('сумма растёт вместе с количеством и не теряет копеек на больших объёмах', () => {
    expect(qtyTotal(1_500n, 1000, 1_000_000_000)).toBe(1_500_000_000n);
  });
});

describe('количество в заказе', () => {
  const GOLD = { unitName: 'золото', minQty: 10_000, stock: 250_000 };

  it('в границах — можно', () => {
    expect(qtyError(10_000, GOLD)).toBeNull();
    expect(qtyError(250_000, GOLD)).toBeNull();
  });

  it('меньше минимума и больше наличия — нельзя, с числом в тексте', () => {
    expect(qtyError(9_999, GOLD)).toMatch(/Минимум.*10\s000 золото/);
    expect(qtyError(250_001, GOLD)).toMatch(/только 250\s000/);
  });

  it('пустой склад — «закончился», а не «в наличии только 0»', () => {
    expect(qtyError(1, { unitName: null, minQty: 1, stock: 0 })).toBe('Лот закончился');
  });

  it('ноль, дробь и отрицательное не принимаются', () => {
    for (const q of [0, -3, 1.5]) expect(qtyError(q, GOLD)).toBe('Укажите количество');
  });

  it('без наличия (null) ограничения сверху нет', () => {
    expect(qtyError(5, { unitName: 'шт.', minQty: 1, stock: null })).toBeNull();
  });
});

describe('условия продавца', () => {
  const OK = { unitName: 'золото', pricePerUnits: 1000, minQty: 1000, stock: 500_000 };

  it('обычные условия годятся', () => {
    expect(qtyTermsError(OK)).toBeNull();
  });

  it('без единицы и без наличия — нельзя', () => {
    expect(qtyTermsError({ ...OK, unitName: ' ' })).toMatch(/единицу/);
    expect(qtyTermsError({ ...OK, stock: null })).toMatch(/наличие/);
  });

  it('пачка — только из списка: «за 7 единиц» покупатель не поймёт', () => {
    expect(qtyTermsError({ ...OK, pricePerUnits: 7 })).toMatch(/1 000/);
  });

  it('минимум от единицы, наличие не отрицательное', () => {
    expect(qtyTermsError({ ...OK, minQty: 0 })).toMatch(/Минимум/);
    expect(qtyTermsError({ ...OK, stock: -1 })).toMatch(/Наличие/);
  });
});

describe('какие лоты продаются количеством', () => {
  it('с единицей и все авто-лоты ключей', () => {
    expect(soldByQty({ unitName: 'золото', fulfillmentType: 'manual' })).toBe(true);
    expect(soldByQty({ unitName: null, fulfillmentType: 'auto_key' })).toBe(true);
    expect(soldByQty({ unitName: null, fulfillmentType: 'manual' })).toBe(false);
  });
});

describe('скидка за количество', () => {
  const tiers = [
    { from: 10_000, pct: 5 },
    { from: 50_000, pct: 10 },
  ];

  it('ступень — наибольшая, до которой дотянулось количество; скидка вниз до копейки', () => {
    // 15 ₽ за 1000 золота: 25 000 — 375 ₽, −5% = 18,75 ₽.
    expect(qtyPrice(1_500n, 1000, 25_000, tiers)).toEqual({
      full: 37_500n,
      discount: 1_875n,
      total: 35_625n,
      tier: { from: 10_000, pct: 5 },
    });
    expect(qtyPrice(1_500n, 1000, 50_000, tiers).tier?.pct).toBe(10);
    expect(qtyPrice(1_500n, 1000, 9_999, tiers)).toMatchObject({ discount: 0n, tier: null });
    expect(qtyPrice(999n, 1, 3, [{ from: 2, pct: 15 }]).discount).toBe(449n); // 449,55 → 449
  });

  it('следующая ступень — для подсказки «возьмите ещё»', () => {
    expect(nextQtyTier(tiers, 5_000)).toEqual({ from: 10_000, pct: 5 });
    expect(nextQtyTier(tiers, 10_000)).toEqual({ from: 50_000, pct: 10 });
    expect(nextQtyTier(tiers, 60_000)).toBeNull();
  });

  it('из JSON лота — только целые и по возрастанию', () => {
    expect(
      qtyTiers([{ from: 50, pct: 10 }, { from: 10, pct: 5 }, { from: 'x', pct: 3 }, null]),
    ).toEqual([
      { from: 10, pct: 5 },
      { from: 50, pct: 10 },
    ]);
    expect(qtyTiers(null)).toEqual([]);
  });

  it('ступени продавца: больше минимума, 1–50%, растут вместе, не больше трёх', () => {
    expect(qtyTiersError(tiers, 1_000)).toBeNull();
    expect(qtyTiersError([{ from: 1_000, pct: 5 }], 1_000)).toMatch(/больше минимума/);
    expect(qtyTiersError([{ from: 2_000, pct: 60 }], 1_000)).toMatch(/от 1 до 50%/);
    expect(
      qtyTiersError(
        [
          { from: 2_000, pct: 10 },
          { from: 5_000, pct: 5 },
        ],
        1,
      ),
    ).toMatch(/по возрастанию/);
    expect(
      qtyTiersError(
        [
          { from: 2, pct: 1 },
          { from: 3, pct: 2 },
          { from: 4, pct: 3 },
          { from: 5, pct: 4 },
        ],
        1,
      ),
    ).toMatch(/Не больше 3/);
  });
});
