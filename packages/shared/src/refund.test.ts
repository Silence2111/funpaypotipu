import { describe, expect, it } from 'vitest';
import { assertBalanced, refundToOriginal } from './accounting';
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
