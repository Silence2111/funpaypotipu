import { describe, expect, it, vi } from 'vitest';
import { computeFees } from '@gamemarket/shared';
import { FeesController } from '../src/modules/orders/fees.controller';

/**
 * Калькулятор «Продавать на GameMarket»: без входа, наша комиссия — из того
 * же правила раздела, что и настоящая сделка, без скидки уровня (новый
 * продавец); вывод — на СБП; конкуренты — по их опубликованным ставкам.
 */

const CAT = '0b6f6c1e-4a2b-4c3d-8e9f-001122334455';

function setup(segment: string | null, sellerPct = 0.1) {
  const fees = {
    categoryForEstimate: vi.fn(async () => (segment ? { segment } : null)),
    computeForCategory: vi.fn(async (base: bigint) => ({ ...computeFees(base, 0, sellerPct), sellerPct })),
  };
  return { c: new FeesController(fees as never), fees };
}

describe('сколько вы получите', () => {
  it('аккаунт за 1 000 ₽: у нас 10% и вывод 25 ₽ — 875 ₽; FunPay 9% и вывод 30 ₽ — 880 ₽; Playerok 20% и 60 ₽ — 740 ₽', async () => {
    const { c, fees } = setup('accounts');
    const r = await c.estimate({ categoryId: CAT, price: 100_000 });
    expect(r.ours).toEqual({ feePct: 0.1, fee: '10000', payout: '90000', withdrawFee: '2500', net: '87500' });
    expect(r.competitors.funpay).toMatchObject({ feePct: 0.09, withdrawFee: '3000', net: '88000' });
    expect(r.competitors.playerok).toMatchObject({ feePct: 0.2, withdrawFee: '6000', net: '74000' });
    // Новый продавец: без id продавца — без скидки уровня.
    expect(fees.computeForCategory).toHaveBeenCalledWith(100_000n, CAT, 'RUB');
    expect(r.withdrawal).toEqual({ key: 'sbp', feePct: 0.025, minFee: '2500' });
    expect(r.ratesCheckedAt).toBe('2026-09-26');
  });

  it('ключи: правило раздела 7% — так и считается; у Playerok на ключи 10%', async () => {
    const { c } = setup('key', 0.07);
    const r = await c.estimate({ categoryId: CAT, price: 100_000 });
    expect(r.ours).toMatchObject({ feePct: 0.07, fee: '7000' });
    expect(r.competitors.playerok.feePct).toBe(0.1);
  });

  it('закрытый или несуществующий раздел — 404, а не расчёт по общему правилу', async () => {
    const { c } = setup(null);
    await expect(c.estimate({ categoryId: CAT, price: 100_000 })).rejects.toThrow('Раздел не найден');
  });
});
