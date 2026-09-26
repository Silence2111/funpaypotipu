import { describe, it, expect } from 'vitest';
import { FeesController } from '../src/modules/orders/fees.controller';
import { cashbackPct, WITHDRAWAL_METHODS } from '@gamemarket/shared';

/**
 * Прайс на витрине должен приходить из тех же правил, по которым считается
 * реальная сделка. Раньше его там не было вовсе, и любая цифра на лендинге
 * была бы обычным текстом: поменяли правило в админке — главная продолжает
 * обещать старое, а покупатель узнаёт правду после оплаты.
 */

const feesStub = (rules: Array<{ feeBuyerPct: number; feeSellerPct: number }>) =>
  ({ activeRules: async () => rules }) as never;

describe('публичный прайс площадки', () => {
  it('ставки берутся из активных правил, а не из разметки', async () => {
    const c = new FeesController(feesStub([
      { feeBuyerPct: 0, feeSellerPct: 0.1 },
      { feeBuyerPct: 0, feeSellerPct: 0.07 },
    ]));
    const r = await c.publicPricing();
    expect(r.sellerFeeMinPct).toBe(0.07);
    expect(r.sellerFeeMaxPct).toBe(0.1);
  });

  it('одна ставка — минимум равен максимуму, а не вилка из ниоткуда', async () => {
    const c = new FeesController(feesStub([{ feeBuyerPct: 0, feeSellerPct: 0.1 }]));
    const r = await c.publicPricing();
    expect(r.sellerFeeMinPct).toBe(r.sellerFeeMaxPct);
  });

  it('без правил комиссия ноль, а не «взяли что было»', async () => {
    const c = new FeesController(feesStub([]));
    const r = await c.publicPricing();
    expect(r.sellerFeeMinPct).toBe(0);
    expect(r.sellerFeeMaxPct).toBe(0);
  });

  it('нулевые правила не попадают в вилку: «комиссия от 0%» — неправда', async () => {
    const c = new FeesController(feesStub([
      { feeBuyerPct: 0, feeSellerPct: 0 },
      { feeBuyerPct: 0, feeSellerPct: 0.1 },
    ]));
    const r = await c.publicPricing();
    expect(r.sellerFeeMinPct).toBe(0.1);
  });

  it('кэшбэк и ставки вывода совпадают с теми, что считает кошелёк', async () => {
    const c = new FeesController(feesStub([{ feeBuyerPct: 0, feeSellerPct: 0.1 }]));
    const r = await c.publicPricing();
    expect(r.cashbackPct).toBe(cashbackPct());
    expect(r.withdrawal).toHaveLength(WITHDRAWAL_METHODS.length);
    expect(r.withdrawal.map((w) => w.key)).toEqual(WITHDRAWAL_METHODS.map((m) => m.key));
  });

  it('скидка уровня отдаётся в процентных пунктах, а не в базисных', async () => {
    const c = new FeesController(feesStub([{ feeBuyerPct: 0, feeSellerPct: 0.1 }]));
    const r = await c.publicPricing();
    // 300 bps у Pro-продавца = 3 процентных пункта
    expect(r.levelDiscountMaxPp).toBe(3);
  });
});
