import { describe, it, expect } from 'vitest';
import { computeFees } from './money';
import {
  acquiringCostPct,
  cashbackPct,
  dealEconomics,
  explainDeal,
  maxPromoDiscount,
  minMarginPct,
} from './unit-economics';

/**
 * Четыре механики — комиссия, скидка уровня, промокод и кэшбэк — считались
 * по отдельности и ни разу вместе. Здесь проверяется именно сумма.
 */

// Заказ 1 000 ₽ в категории ключей (7%) у Pro-продавца (скидка 3 п.п.).
const KEYS_PRO = computeFees(100_000n, 0, 0.04);

describe('арифметика сделки для площадки', () => {
  it('без скидки и при оплате с баланса сделка в плюсе', () => {
    const e = dealEconomics({
      amountToPay: KEYS_PRO.amountToPay,
      sellerPayout: KEYS_PRO.sellerPayout,
      paymentMethod: 'balance',
    });
    expect(e.grossRevenue).toBe(4000n);
    expect(e.net).toBeGreaterThan(0n);
  });

  it('кэшбэк вычитается из комиссии, а не появляется из воздуха', () => {
    const e = dealEconomics({
      amountToPay: KEYS_PRO.amountToPay,
      sellerPayout: KEYS_PRO.sellerPayout,
      paymentMethod: 'balance',
    });
    expect(e.cashback).toBe(BigInt(Math.round(100_000 * cashbackPct())));
    expect(e.net).toBe(e.grossRevenue - e.cashback - e.acquiringCost);
  });

  it('СБП бесплатен для покупателя, но не для нас', () => {
    expect(acquiringCostPct('sbp')).toBeGreaterThan(0);
    const e = dealEconomics({
      amountToPay: KEYS_PRO.amountToPay,
      sellerPayout: KEYS_PRO.sellerPayout,
      paymentMethod: 'sbp',
    });
    expect(e.acquiringCost).toBeGreaterThan(0n);
  });

  it('оплата с баланса нам ничего не стоит', () => {
    expect(acquiringCostPct('balance')).toBe(0);
  });

  it('промокод на всю комиссию уводит сделку в минус — это и был баг', () => {
    const e = dealEconomics({
      amountToPay: KEYS_PRO.amountToPay,
      sellerPayout: KEYS_PRO.sellerPayout,
      promoDiscount: KEYS_PRO.amountToPay - KEYS_PRO.sellerPayout, // старый потолок
      paymentMethod: 'sbp',
    });
    expect(e.net).toBeLessThan(0n);
    expect(e.ok).toBe(false);
  });

  it('убыток растёт вместе с чеком, а не исчезает на крупных заказах', () => {
    const мелкий = computeFees(50_000n, 0, 0.04);
    const крупный = computeFees(500_000n, 0, 0.04);
    const a = dealEconomics({
      amountToPay: мелкий.amountToPay,
      sellerPayout: мелкий.sellerPayout,
      promoDiscount: мелкий.amountToPay - мелкий.sellerPayout,
      paymentMethod: 'sbp',
    });
    const b = dealEconomics({
      amountToPay: крупный.amountToPay,
      sellerPayout: крупный.sellerPayout,
      promoDiscount: крупный.amountToPay - крупный.sellerPayout,
      paymentMethod: 'sbp',
    });
    expect(b.net).toBeLessThan(a.net);
  });
});

describe('потолок промокода', () => {
  const input = {
    amountToPay: KEYS_PRO.amountToPay,
    sellerPayout: KEYS_PRO.sellerPayout,
    paymentMethod: 'sbp',
  };

  it('ниже валовой комиссии — потому что из неё ещё платить', () => {
    const limit = maxPromoDiscount(input);
    expect(limit).toBeLessThan(KEYS_PRO.amountToPay - KEYS_PRO.sellerPayout);
    expect(limit).toBeGreaterThanOrEqual(0n);
  });

  it('скидка ровно по потолку оставляет сделку неубыточной', () => {
    const e = dealEconomics({ ...input, promoDiscount: maxPromoDiscount(input) });
    expect(e.net).toBeGreaterThanOrEqual(0n);
  });

  it('на рубль выше потолка сделка уже в минусе по нашей границе', () => {
    const limit = maxPromoDiscount(input);
    const e = dealEconomics({ ...input, promoDiscount: limit + 100n });
    expect(e.marginPct).toBeLessThan(minMarginPct());
  });

  it('карта дороже СБП, поэтому и скидка меньше', () => {
    expect(maxPromoDiscount({ ...input, paymentMethod: 'card' })).toBeLessThan(
      maxPromoDiscount({ ...input, paymentMethod: 'sbp' }),
    );
  });

  it('при нулевой комиссии скидки нет вообще', () => {
    const free = computeFees(100_000n, 0, 0);
    expect(
      maxPromoDiscount({
        amountToPay: free.amountToPay,
        sellerPayout: free.sellerPayout,
        paymentMethod: 'sbp',
      }),
    ).toBe(0n);
  });

  it('тонкой комиссии не хватает даже на кэшбэк — скидка ноль', () => {
    // 1% комиссии против 2% кэшбэка: скидывать нечего.
    const thin = computeFees(100_000n, 0, 0.01);
    expect(
      maxPromoDiscount({
        amountToPay: thin.amountToPay,
        sellerPayout: thin.sellerPayout,
        paymentMethod: 'sbp',
      }),
    ).toBe(0n);
  });
});

describe('объяснение для журнала', () => {
  it('на убыточной сделке называет сумму потери', () => {
    const e = dealEconomics({
      amountToPay: KEYS_PRO.amountToPay,
      sellerPayout: KEYS_PRO.sellerPayout,
      promoDiscount: KEYS_PRO.amountToPay - KEYS_PRO.sellerPayout,
      paymentMethod: 'card',
    });
    const text = explainDeal(e);
    expect(text).toContain('убыточна');
    expect(text).toMatch(/теряет \d+\.\d\d ₽/);
  });

  it('на прибыльной называет остаток и процент', () => {
    const e = dealEconomics({
      amountToPay: KEYS_PRO.amountToPay,
      sellerPayout: KEYS_PRO.sellerPayout,
      paymentMethod: 'balance',
    });
    expect(explainDeal(e)).toContain('площадке');
    expect(explainDeal(e)).toMatch(/\d+\.\d%/);
  });
});
