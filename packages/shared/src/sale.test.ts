import { describe, expect, it } from 'vitest';
import { saleOff, salePrice, saleReference } from './sale';

describe('скидка на лот', () => {
  it('цена со скидкой — до копейки вниз', () => {
    expect(salePrice(150000n, 20)).toBe(120000n);
    expect(salePrice(999n, 15)).toBe(849n); // 849,15 → 849
  });

  it('пометка «−N%» — от прежней цены целым числом; без скидки — нет', () => {
    expect(saleOff('150000', '120000')).toBe(20);
    expect(saleOff(999n, 849n)).toBe(15);
    expect(saleOff(null, '120000')).toBeNull();
    expect(saleOff('100000', '100000')).toBeNull();
    expect(saleOff('100000', '120000')).toBeNull();
  });
});

describe('честная прежняя цена', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const ago = (d: number) => new Date(now - d * 86_400_000).toISOString();

  it('самая низкая за 7 дней — с ценой на начало окна и нынешней', () => {
    // Держалась 1 000 ₽, за два дня до скидки подняли до 1 200 ₽ — честная прежняя 1 000 ₽.
    expect(
      saleReference(
        [
          { at: ago(30), price: '100000' },
          { at: ago(2), price: '120000' },
        ],
        120000n,
        now,
      ),
    ).toBe(100000n);
    // Цена держалась неделю — прежняя и есть нынешняя.
    expect(saleReference([{ at: ago(10), price: '120000' }], 120000n, now)).toBe(120000n);
    // Снижали внутри недели — в счёт идёт самая низкая.
    expect(
      saleReference(
        [
          { at: ago(10), price: '150000' },
          { at: ago(5), price: '110000' },
          { at: ago(1), price: '150000' },
        ],
        150000n,
        now,
      ),
    ).toBe(110000n);
    // Истории нет — нынешняя цена.
    expect(saleReference([], 99900n, now)).toBe(99900n);
  });
});
