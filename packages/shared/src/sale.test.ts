import { describe, expect, it } from 'vitest';
import { saleOff, salePrice } from './sale';

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
