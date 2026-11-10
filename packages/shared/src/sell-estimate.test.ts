import { describe, expect, it } from 'vitest';
import { competitorOutcome, sellOutcome } from './sell-estimate';

/**
 * «Сколько вы получите»: продажа и вывод у нас и у конкурентов. Ошибка
 * здесь — обещание продавцу, которое не сбудется, поэтому сверяем рубли.
 */

describe('продажа и вывод', () => {
  it('у нас: 1 000 ₽, комиссия 10% — 900 ₽ на балансе, вывод 2,5% — 22,50 ₽, на руки 877,50 ₽', () => {
    expect(sellOutcome(100_000n, 0.1, 10_000n, { feePct: 0.025, minFee: 2_500n })).toEqual({
      feePct: 0.1,
      fee: 10_000n,
      payout: 90_000n,
      withdrawFee: 2_500n, // 2,5% от 900 ₽ = 22,50 ₽ меньше минимума 25 ₽
      net: 87_500n,
    });
  });

  it('Playerok: аккаунт за 1 000 ₽ — 20% и вывод 6%, на руки 752 ₽; ключ — 10%', () => {
    expect(competitorOutcome('playerok', 100_000n, 'accounts')).toMatchObject({
      feePct: 0.2,
      fee: 20_000n,
      payout: 80_000n,
      withdrawFee: 6_000n, // 6% от 800 ₽ = 48 ₽ меньше минимума 60 ₽
      net: 74_000n,
    });
    expect(competitorOutcome('playerok', 100_000n, 'key')).toMatchObject({ feePct: 0.1, fee: 10_000n });
    expect(competitorOutcome('playerok', 100_000n, 'topup').feePct).toBe(0.1);
  });

  it('FunPay: средние 9% и вывод 3%, минимум 30 ₽', () => {
    expect(competitorOutcome('funpay', 1_000_000n, 'items')).toMatchObject({
      fee: 90_000n,
      payout: 910_000n,
      withdrawFee: 27_300n, // 3% от 9 100 ₽ = 273 ₽
      net: 882_700n,
    });
  });

  it('мелкая продажа: вывод не больше суммы — на руки не меньше нуля', () => {
    expect(competitorOutcome('playerok', 5_000n, 'accounts')).toMatchObject({ payout: 4_000n, withdrawFee: 4_000n, net: 0n });
  });
});
