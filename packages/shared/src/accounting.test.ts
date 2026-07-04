import { describe, expect, it } from 'vitest';
import { computeFees } from './money';
import {
  assertBalanced,
  balanceDelta,
  payToEscrowFromGateway,
  payToEscrowFromBalance,
  releaseEscrow,
  refundToBalance,
  holdForPayout,
  settlePayout,
  reversePayoutHold,
  UnbalancedPostingError,
  type PostingLeg,
} from './accounting';

const sum = (legs: PostingLeg[], dir: 'debit' | 'credit'): bigint =>
  legs.filter((l) => l.direction === dir).reduce((a, l) => a + l.amount, 0n);

describe('accounting: сбалансированность потоков', () => {
  it('оплата с провайдера в эскроу сбалансирована', () => {
    const legs = payToEscrowFromGateway(100_00n);
    expect(() => assertBalanced(legs)).not.toThrow();
    expect(sum(legs, 'debit')).toBe(sum(legs, 'credit'));
  });

  it('оплата с баланса в эскроу сбалансирована', () => {
    const legs = payToEscrowFromBalance('buyer-1', 250_00n);
    expect(() => assertBalanced(legs)).not.toThrow();
  });

  it('релиз эскроу: выплата + комиссия = удержанной сумме', () => {
    const legs = releaseEscrow('seller-1', 90_00n, 10_00n);
    expect(() => assertBalanced(legs)).not.toThrow();
    expect(sum(legs, 'debit')).toBe(100_00n);
    expect(sum(legs, 'credit')).toBe(100_00n);
  });

  it('возврат покупателю сбалансирован', () => {
    const legs = refundToBalance('buyer-1', 100_00n);
    expect(() => assertBalanced(legs)).not.toThrow();
  });

  it('выплата: hold → settle сбалансированы и замкнуты', () => {
    const hold = holdForPayout('seller-1', 90_00n);
    const settle = settlePayout(90_00n);
    expect(() => assertBalanced(hold)).not.toThrow();
    expect(() => assertBalanced(settle)).not.toThrow();
    // available -90 (hold), payout_payable 0 (hold +90, settle -90) → замкнуто
    expect(sum([...hold, ...settle], 'debit')).toBe(sum([...hold, ...settle], 'credit'));
  });

  it('отклонённая выплата: hold → reverse возвращает на баланс', () => {
    const legs = [...holdForPayout('seller-1', 50_00n), ...reversePayoutHold('seller-1', 50_00n)];
    expect(() => assertBalanced(legs)).not.toThrow();
    // net по available и payout_payable = 0
    expect(legs.reduce((a, l) => a + balanceDelta(l), 0n)).toBe(0n);
  });
});

describe('accounting: инвариант', () => {
  it('несбалансированный набор бросает UnbalancedPostingError', () => {
    const bad: PostingLeg[] = [
      { account: { ownerType: 'platform', ownerId: null, kind: 'escrow' }, direction: 'debit', amount: 100n },
      { account: { ownerType: 'platform', ownerId: null, kind: 'revenue' }, direction: 'credit', amount: 99n },
    ];
    expect(() => assertBalanced(bad)).toThrow(UnbalancedPostingError);
  });

  it('отрицательная сумма запрещена', () => {
    const bad: PostingLeg[] = [
      { account: { ownerType: 'user', ownerId: 'x', kind: 'available' }, direction: 'debit', amount: -1n },
    ];
    expect(() => assertBalanced(bad)).toThrow();
  });

  it('balanceDelta: кредит +, дебет -', () => {
    const legs = payToEscrowFromBalance('b', 500n);
    // сумма всех дельт по сбалансированному набору = 0
    expect(legs.reduce((a, l) => a + balanceDelta(l), 0n)).toBe(0n);
  });
});

describe('money: комиссии (docs/03 §5)', () => {
  it('двойная комиссия: revenue = amountToPay - sellerPayout', () => {
    const f = computeFees(1000_00n, 0.05, 0.1);
    expect(f.amountToPay).toBe(1050_00n); // покупатель платит base + 5%
    expect(f.sellerPayout).toBe(900_00n); // продавец получает base - 10%
    expect(f.platformRevenue).toBe(f.amountToPay - f.sellerPayout);
    expect(f.platformRevenue).toBe(150_00n);
  });

  it('нулевые комиссии: платит=получает=base, revenue=0', () => {
    const f = computeFees(500_00n, 0, 0);
    expect(f.amountToPay).toBe(500_00n);
    expect(f.sellerPayout).toBe(500_00n);
    expect(f.platformRevenue).toBe(0n);
  });

  it('свойство: для случайных сумм revenue >= 0 и потоки сходятся', () => {
    for (let i = 0; i < 200; i++) {
      const base = BigInt(1 + Math.floor((i * 733) % 100000));
      const sellerPct = ((i * 7) % 30) / 100;
      const buyerPct = ((i * 3) % 20) / 100;
      const f = computeFees(base, buyerPct, sellerPct);
      expect(f.platformRevenue).toBe(f.amountToPay - f.sellerPayout);
      expect(f.platformRevenue >= 0n).toBe(true);
      // релиз эскроу на эти суммы обязан быть сбалансирован
      const legs = releaseEscrow('s', f.sellerPayout, f.platformRevenue);
      expect(() => assertBalanced([...payToEscrowFromGateway(f.amountToPay), ...legs])).not.toThrow();
    }
  });
});
