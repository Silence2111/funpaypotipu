import { describe, expect, it, vi } from 'vitest';
import { SellersService } from '../src/modules/sellers/sellers.service';

/**
 * «Сегодня» в кабинете продавца. Проверяется: день — по Москве (в 00:30 по
 * Москве уже новый день, хотя по UTC ещё вчера), продажи — оплаченные в этот
 * день и не отменённые, заработано — выплата продавцу; без лотов и сделок
 * сводка не нужна.
 */

type Row = Record<string, unknown>;

function setup(opts: { listings?: number; orders?: number } = {}) {
  const prisma = {
    order: {
      aggregate: vi.fn(async ({ where }: { where: { paidAt: { gte: Date } } }) =>
        where.paidAt.gte.toISOString() === '2026-10-22T21:00:00.000Z'
          ? { _count: { _all: 3 }, _sum: { sellerPayoutAmount: 245000n } }
          : { _count: { _all: 0 }, _sum: { sellerPayoutAmount: null } },
      ),
      count: vi.fn(async ({ where }: { where: Row }) =>
        where.status === 'paid'
          ? 2
          : where.status === 'disputed'
            ? 1
            : where.status
              ? 0
              : (opts.orders ?? 0),
      ),
    },
    listingViewDay: { aggregate: vi.fn(async () => ({ _sum: { views: 57 } })) },
    message: { count: vi.fn(async () => 4) },
    listing: {
      count: vi.fn(async ({ where }: { where: Row }) =>
        where.status === 'sold_out' ? 1 : 'saleUntil' in where ? 1 : (opts.listings ?? 5),
      ),
    },
  };
  return { svc: new SellersService(prisma as never), prisma };
}

describe('сводка «Сегодня»', () => {
  // 22 октября, 21:30 UTC — уже 23 октября, 00:30 по Москве.
  const now = new Date('2026-10-22T21:30:00Z');

  it('день по Москве; продажи и заработанное за сегодня и вчера; что ждёт продавца', async () => {
    const { svc, prisma } = setup();
    const r = await svc.today('s1', now);
    expect(r).toEqual({
      day: '2026-10-23',
      seller: true,
      sales: { count: 3, earned: '245000' },
      yesterday: { count: 0, earned: '0' },
      views: 57,
      waiting: {
        toDeliver: 2,
        awaitingBuyer: 0,
        disputes: 1,
        unreadMessages: 4,
        soldOut: 1,
        salesEnding: 1,
      },
    });
    const todayWhere = prisma.order.aggregate.mock.calls[0]![0].where as Row;
    expect(todayWhere).toMatchObject({
      paidAt: { gte: new Date('2026-10-22T21:00:00Z'), lt: new Date('2026-10-23T21:00:00Z') },
      status: { notIn: ['refunded', 'cancelled', 'expired'] },
    });
    expect(prisma.listingViewDay.aggregate.mock.calls[0]![0]).toMatchObject({
      where: { day: new Date('2026-10-23T00:00:00Z') },
    });
  });

  it('ни лотов, ни сделок — сводка не нужна', async () => {
    const { svc } = setup({ listings: 0, orders: 0 });
    expect((await svc.today('s1', now)).seller).toBe(false);
  });
});
