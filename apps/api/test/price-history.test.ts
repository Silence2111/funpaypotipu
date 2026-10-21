import { describe, expect, it, vi } from 'vitest';
import { ListingsService } from '../src/modules/listings/listings.service';

/**
 * История цены на странице лота. Проверяется: цена до периода — его первая
 * точка, цена за другую пачку пересчитана в текущую, повторы подряд убраны;
 * снятый лот — 404; у пополнения — пометка, что историю не показывать.
 */

type Row = Record<string, unknown>;

function setup(listing: Row | null, before: Row | null, inside: Row[]) {
  const prisma = {
    listing: { findUnique: vi.fn(async () => listing) },
    listingPricePoint: {
      findFirst: vi.fn(async () => before),
      findMany: vi.fn(async () => inside),
    },
  };
  const svc = new ListingsService(prisma as never, {} as never, {} as never, {} as never);
  return { svc, prisma };
}

const day = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('история цены', () => {
  it('первая точка — цена до периода; другая пачка пересчитана; повторы убраны', async () => {
    const { svc } = setup(
      { status: 'active', pricePerUnits: 1000, topupMarkupBps: null },
      { price: 1_500n, pricePerUnits: 1000, at: day(40) },
      [
        { price: 150n, pricePerUnits: 100, at: day(20) }, // 1,50 ₽ за 100 — те же 15 ₽ за 1 000
        { price: 1_200n, pricePerUnits: 1000, at: day(10) },
        { price: 1_200n, pricePerUnits: 1000, at: day(5) },
        { price: 1_400n, pricePerUnits: 1000, at: day(1) },
      ],
    );
    const r = await svc.priceHistory('l1');
    expect(r.days).toBe(30);
    expect(r.topup).toBe(false);
    expect(r.points.map((p) => p.price)).toEqual(['1500', '1200', '1400']);
    expect(new Date(r.points[0]!.at).getTime()).toBeGreaterThan(day(30.01).getTime());
  });

  it('снятый лот — 404; пополнение — с пометкой', async () => {
    await expect(
      setup({ status: 'paused', pricePerUnits: 1 }, null, []).svc.priceHistory('l1'),
    ).rejects.toThrow('Лот не найден');
    const r = await setup({ status: 'active', pricePerUnits: 1, topupMarkupBps: 650 }, null, [
      { price: 10_650n, pricePerUnits: 1, at: day(3) },
    ]).svc.priceHistory('l1');
    expect(r).toMatchObject({ topup: true, points: [{ price: '10650' }] });
  });
});
