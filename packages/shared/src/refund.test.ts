import { describe, expect, it } from 'vitest';
import { assertBalanced, disputeSplit, refundToOriginal, splitEscrow } from './accounting';
import { canRefundToOriginal, refundAmount } from './refund';

describe('возврат при отмене', () => {
  it('исходным способом — карта, СБП, Apple и Google Pay; не баланс, не крипта, не сделка ЮKassa', () => {
    expect(canRefundToOriginal({ paymentMethod: 'card' })).toBe(true);
    expect(canRefundToOriginal({ paymentMethod: 'sbp' })).toBe(true);
    expect(canRefundToOriginal({ paymentMethod: 'balance' })).toBe(false);
    expect(canRefundToOriginal({ paymentMethod: 'crypto' })).toBe(false);
    expect(canRefundToOriginal({ paymentMethod: 'card', dealId: 'd1' })).toBe(false);
  });

  it('на баланс — сумма заказа, на карту — с надбавкой; проводки сходятся', () => {
    expect(refundAmount({ amount: 10000n, paymentSurcharge: 440n }, 'balance')).toBe(10000n);
    expect(refundAmount({ amount: 10000n, paymentSurcharge: 440n }, 'original')).toBe(10440n);
    expect(() => assertBalanced(refundToOriginal(10000n, 440n))).not.toThrow();
    expect(() => assertBalanced(refundToOriginal(10000n))).not.toThrow();
  });
});

describe('частичный возврат по спору (часть 140)', () => {
  it('50% — покупателю половина, продавцу половина его выплаты, площадке остаток; проводки сходятся', () => {
    const split = disputeSplit(10000n, 9000n, 50);
    expect(split).toEqual({ refund: 5000n, sellerPayout: 4500n, revenue: 500n });
    expect(() => assertBalanced(splitEscrow('b', 's', split))).not.toThrow();
    expect(disputeSplit(10000n, 9000n, 100)).toEqual({ refund: 10000n, sellerPayout: 0n, revenue: 0n });
  });
});

