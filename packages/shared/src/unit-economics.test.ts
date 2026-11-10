import { describe, it, expect } from 'vitest';
import { computeFees } from './money';
import { SELLER_LEVELS, effectiveSellerPct } from './seller-level';
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

// Заказ 1 000 ₽ в категории ключей у Pro-продавца. Ставка категории — входные
// данные (FeeRule из сида), а скидка уровня берётся из кода: раньше здесь
// стояло готовое 0.04, и тест не заметил, что в бою скидка обнуляла комиссию.
const KEYS_RULE_PCT = 0.07;
const KEYS_PRO_PCT = effectiveSellerPct(KEYS_RULE_PCT, SELLER_LEVELS.pro);
const KEYS_PRO = computeFees(100_000n, 0, KEYS_PRO_PCT);

describe('арифметика сделки для площадки', () => {
  it('без скидки и при оплате с баланса сделка в плюсе', () => {
    const e = dealEconomics({
      amountToPay: KEYS_PRO.amountToPay,
      sellerPayout: KEYS_PRO.sellerPayout,
      paymentMethod: 'balance',
    });
    expect(e.grossRevenue).toBe(BigInt(Math.round(100_000 * KEYS_PRO_PCT)));
    expect(e.grossRevenue).toBeGreaterThan(0n);
    expect(e.net).toBeGreaterThan(0n);
  });

  it('кэшбэк вычитается из комиссии, а не появляется из воздуха', () => {
    const e = dealEconomics({
      amountToPay: KEYS_PRO.amountToPay,
      sellerPayout: KEYS_PRO.sellerPayout,
      paymentMethod: 'balance',
    });
    expect(e.cashback).toBe(BigInt(Math.floor(100_000 * cashbackPct())));
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
    const мелкий = computeFees(50_000n, 0, KEYS_PRO_PCT);
    const крупный = computeFees(500_000n, 0, KEYS_PRO_PCT);
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

  it('крипта дороже СБП для площадки, поэтому и скидка меньше', () => {
    expect(maxPromoDiscount({ ...input, paymentMethod: 'crypto' })).toBeLessThan(
      maxPromoDiscount({ ...input, paymentMethod: 'sbp' }),
    );
  });

  it('способ оплаты ещё не выбран — потолок по самому дорогому', () => {
    const { paymentMethod: _omit, ...unknown } = input;
    const worst = maxPromoDiscount(unknown);
    for (const m of ['balance', 'sbp', 'crypto', 'card']) {
      expect(worst).toBeLessThanOrEqual(maxPromoDiscount({ ...input, paymentMethod: m }));
      // и по этому потолку сделка не уходит в минус ни при каком способе
      expect(dealEconomics({ ...input, paymentMethod: m, promoDiscount: worst }).net).toBeGreaterThanOrEqual(0n);
    }
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
    // Комиссия вдвое меньше кэшбэка: скидывать нечего. Ставка выводится из
    // cashbackPct(), чтобы тест не сломался «не по той причине» при смене кэшбэка.
    const thin = computeFees(100_000n, 0, cashbackPct() / 2);
    expect(
      maxPromoDiscount({
        amountToPay: thin.amountToPay,
        sellerPayout: thin.sellerPayout,
        paymentMethod: 'sbp',
      }),
    ).toBe(0n);
  });
});

describe('надбавка за карту', () => {
  it('покупатель платит её сверх суммы, а провайдер берёт комиссию со всего платежа', () => {
    const e = dealEconomics({
      amountToPay: KEYS_PRO.amountToPay,
      sellerPayout: KEYS_PRO.sellerPayout,
      paymentMethod: 'card',
    });
    expect(e.surcharge).toBe(4_400n); // 4.4% от 1 000 ₽
    // 3% от 1 044 ₽ = 31,32 ₽ комиссии минус 44 ₽ надбавки
    expect(e.acquiringCost).toBe(BigInt(Math.round(104_400 * acquiringCostPct('card'))) - 4_400n);
  });

  it('у оплаты без надбавки эквайринг — чистый расход', () => {
    const e = dealEconomics({
      amountToPay: KEYS_PRO.amountToPay,
      sellerPayout: KEYS_PRO.sellerPayout,
      paymentMethod: 'sbp',
    });
    expect(e.surcharge).toBe(0n);
    expect(e.acquiringCost).toBe(BigInt(Math.round(100_000 * acquiringCostPct('sbp'))));
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
