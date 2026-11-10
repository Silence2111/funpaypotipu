import { describe, it, expect } from 'vitest';
import { FeesService } from '../src/modules/orders/fees.service';
import { SELLER_LEVELS, effectiveSellerPct } from '@gamemarket/shared';

/**
 * Реальный путь расчёта комиссии в API, а не только формула в shared:
 * баг сидел именно в FeesService (`feeDiscountBps / 100`), и формула
 * в shared его бы не поймала.
 */
const RULE = { feeBuyerPct: 0, feeSellerPct: 0.07 };

const prismaStub = (profile: {
  salesCount: number;
  ratingAvg: number;
  ratingCount: number;
}, verified: boolean) =>
  ({
    feeRule: { findFirst: async () => RULE },
    profile: { findUnique: async () => profile },
    kycVerification: { findFirst: async () => (verified ? { id: 'k' } : null) },
  }) as never;

const PRO = { salesCount: 100, ratingAvg: 4.9, ratingCount: 50 };

describe('комиссия с учётом уровня продавца', () => {
  it('Pro-продавец платит ставку минус скидку, а не ноль', async () => {
    const svc = new FeesService(prismaStub(PRO, true));
    const f = await svc.computeForCategory(100_000n, 'cat', 'RUB', 'seller');
    expect(f.level?.key).toBe('pro');
    const ожидаемая = effectiveSellerPct(RULE.feeSellerPct, SELLER_LEVELS.pro);
    expect(f.feeSeller).toBe(BigInt(Math.round(100_000 * ожидаемая)));
    expect(f.feeSeller).toBeGreaterThan(0n);
  });

  it('новичок платит ставку правила целиком', async () => {
    const svc = new FeesService(
      prismaStub({ salesCount: 0, ratingAvg: 0, ratingCount: 0 }, false),
    );
    const f = await svc.computeForCategory(100_000n, 'cat', 'RUB', 'seller');
    expect(f.feeSeller).toBe(BigInt(Math.round(100_000 * RULE.feeSellerPct)));
  });
});
