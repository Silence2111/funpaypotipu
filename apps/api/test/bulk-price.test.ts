import { describe, expect, it, vi } from 'vitest';
import { ListingsService } from '../src/modules/listings/listings.service';

/**
 * Цены выбранных лотов разом. Проверяется: каждая цена меняется условно (та
 * же цена, без скидки), с обновлением индекса; лот со скидкой, пополнение,
 * цена меньше рубля, цена без изменений, чужой и изменённый в соседней
 * вкладке лот — пропуск с причиной.
 */

type Row = Record<string, unknown>;

function setup(rows: Row[], opts: { lost?: string[] } = {}) {
  const prisma = {
    listing: {
      findMany: vi.fn(async () => rows),
      updateMany: vi.fn(async ({ where }: { where: { id: string } }) => ({
        count: opts.lost?.includes(where.id) ? 0 : 1,
      })),
    },
  };
  const search = { indexListing: vi.fn(async () => undefined) };
  const svc = new ListingsService(prisma as never, search as never, {} as never, {} as never);
  return { svc, prisma, search };
}

const lot = (id: string, price: bigint, over: Row = {}): Row => ({
  id,
  price,
  saleUntil: null,
  topupMarkupBps: null,
  ...over,
});

describe('цены разом', () => {
  it('+7%: цена условно, в рублях — в рублях, индекс обновлён', async () => {
    const { svc, prisma, search } = setup([lot('a', 99_900n), lot('b', 1_550n)]);
    expect(await svc.bulkPrice('s1', ['a', 'b'], 7)).toEqual({ done: 2, skipped: [] });
    expect(prisma.listing.updateMany.mock.calls.map((c) => c[0])).toEqual([
      {
        where: { id: 'a', sellerId: 's1', price: 99_900n, saleUntil: null },
        data: { price: 106_900n },
      },
      {
        where: { id: 'b', sellerId: 's1', price: 1_550n, saleUntil: null },
        data: { price: 1_659n },
      },
    ]);
    expect(search.indexListing).toHaveBeenCalledTimes(2);
  });

  it('скидка, пополнение, меньше рубля, без изменений, чужой и изменённый — пропуск с причиной', async () => {
    const { svc, prisma } = setup(
      [
        lot('sale', 100_000n, { saleUntil: new Date(Date.now() + 86_400_000) }),
        lot('topup', 10_000n, { topupMarkupBps: 650 }),
        lot('cheap', 105n), // 1,05 ₽ −10% — 0,95 ₽
        lot('same', 100n), // 1 ₽ −10% — 0,90, в целых рублях снова 1 ₽
        lot('lost', 50_000n),
        lot('ok', 50_000n),
      ],
      { lost: ['lost'] },
    );
    const r = await svc.bulkPrice(
      's1',
      ['sale', 'topup', 'cheap', 'same', 'lost', 'ok', 'foreign'],
      -10,
    );
    expect(r.done).toBe(1);
    expect(Object.fromEntries(r.skipped.map((s) => [s.id, s.reason]))).toEqual({
      foreign: 'unavailable',
      sale: 'sale',
      topup: 'topup',
      cheap: 'min',
      same: 'same',
      lost: 'unavailable',
    });
    expect(prisma.listing.updateMany).toHaveBeenCalledTimes(2);
  });
});
