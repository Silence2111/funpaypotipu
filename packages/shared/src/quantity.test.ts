import { describe, it, expect } from 'vitest';
import { qtyError, qtyTermsError, qtyTotal, soldByQty } from './quantity';

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
