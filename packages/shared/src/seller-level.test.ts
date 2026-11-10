import { describe, it, expect } from 'vitest';
import {
  LEVEL_RULES,
  SELLER_LEVELS,
  effectiveSellerPct,
  levelDiscountFraction,
  sellerLevel,
} from './seller-level';

/**
 * Скидка уровня — главный аргумент для продавца («чем лучше репутация,
 * тем меньше комиссия»). Она же оказалась главной дырой: bps переводились
 * в процентные пункты и вычитались из доли, и комиссия уровней обнулялась.
 * Тесты читают ставки из SELLER_LEVELS, а не из головы.
 */
describe('скидка уровня продавца', () => {
  const КАТЕГОРИЯ = 0.07; // ставка правила — входные данные, как в FeeRule

  it('скидка не обнуляет комиссию ни у одного уровня', () => {
    // Это и был баг: Проверенный и Pro платили 0%.
    for (const level of Object.values(SELLER_LEVELS)) {
      expect(effectiveSellerPct(КАТЕГОРИЯ, level)).toBeGreaterThan(0);
    }
  });

  it('скидка вычитается в тех же единицах, что и ставка', () => {
    const pro = SELLER_LEVELS.pro;
    expect(effectiveSellerPct(КАТЕГОРИЯ, pro)).toBeCloseTo(
      КАТЕГОРИЯ - pro.feeDiscountBps / 10_000,
      10,
    );
  });

  it('скидка не больше самой ставки — иначе площадка доплачивает продавцу', () => {
    for (const level of Object.values(SELLER_LEVELS)) {
      expect(levelDiscountFraction(level)).toBeLessThan(КАТЕГОРИЯ);
    }
  });

  it('новичок платит ставку правила целиком', () => {
    expect(effectiveSellerPct(КАТЕГОРИЯ, SELLER_LEVELS.new)).toBe(КАТЕГОРИЯ);
  });

  it('уровень выше — комиссия ниже: иначе уровни ничего не обещают', () => {
    const n = effectiveSellerPct(КАТЕГОРИЯ, SELLER_LEVELS.new);
    const t = effectiveSellerPct(КАТЕГОРИЯ, SELLER_LEVELS.trusted);
    const p = effectiveSellerPct(КАТЕГОРИЯ, SELLER_LEVELS.pro);
    expect(t).toBeLessThan(n);
    expect(p).toBeLessThan(t);
  });
});

describe('пороги уровней', () => {
  const { trusted, pro } = LEVEL_RULES;

  it('«Проверенный» — ровно с порога продаж и рейтинга', () => {
    const at = { salesCount: trusted.salesCount, ratingAvg: trusted.ratingAvg, ratingCount: 5, verified: false };
    expect(sellerLevel(at).key).toBe('trusted');
    expect(sellerLevel({ ...at, salesCount: trusted.salesCount - 1 }).key).toBe('new');
  });

  it('Pro — только с проверенными документами', () => {
    const at = { salesCount: pro.salesCount, ratingAvg: pro.ratingAvg, ratingCount: pro.ratingCount, verified: true };
    expect(sellerLevel(at).key).toBe('pro');
    expect(sellerLevel({ ...at, verified: false }).key).toBe('trusted');
  });
});
