import { describe, expect, it } from 'vitest';
import { normalizePromoCode, promoCodeError, sellerPromoDiscount } from './seller-promo';

describe('промокод продавца', () => {
  it('код — латиница и цифры, 4–20 знаков, в верхнем регистре', () => {
    expect(normalizePromoCode('  summer10 ')).toBe('SUMMER10');
    expect(promoCodeError('SUMMER10')).toBeNull();
    expect(promoCodeError('ABC')).not.toBeNull();
    expect(promoCodeError('ЛЕТО2026')).not.toBeNull();
    expect(promoCodeError('SUMMER-10')).not.toBeNull();
  });

  it('скидка — процент от цены до копейки вниз', () => {
    expect(sellerPromoDiscount(150000n, 10)).toBe(15000n);
    expect(sellerPromoDiscount(999n, 15)).toBe(149n); // 149,85 → 149
  });
});
