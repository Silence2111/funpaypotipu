import { describe, expect, it, vi } from 'vitest';
import { ListingsService } from '../src/modules/listings/listings.service';

/**
 * «Мои лоты» у продавца с тысячами лотов: строка — только то, что видно в
 * списке (без продавца, фото и параметров), обзор кабинета берёт первые
 * лоты и их число, а не весь список.
 */

function setup(groups: Array<{ status: string; n: number }> = []) {
  const prisma = {
    listing: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => groups.map((g) => ({ status: g.status, _count: { _all: g.n } }))),
    },
  };
  const svc = new ListingsService(
    prisma as never,
    { enabled: false } as never,
    {} as never,
    {} as never,
  );
  return { svc, prisma };
}

describe('мои лоты', () => {
  it('строка без продавца, фото и параметров; архив не входит; limit — для обзора', async () => {
    const { svc, prisma } = setup();
    await svc.listMine('s1');
    await svc.listMine('s1', 5);
    const [all, first] = prisma.listing.findMany.mock.calls.map(
      (c) => (c as unknown[])[0],
    ) as Array<{
      where: unknown;
      take?: number;
      select: Record<string, unknown>;
    }>;
    expect(all!.where).toEqual({ sellerId: 's1', status: { not: 'archived' } });
    expect(all!.take).toBeUndefined();
    expect(first!.take).toBe(5);
    expect(Object.keys(all!.select)).toEqual(
      expect.arrayContaining([
        'id',
        'title',
        'price',
        'status',
        'stock',
        'categoryId',
        'category',
        'game',
      ]),
    );
    for (const heavy of ['seller', 'images', 'attributes', 'qtyDiscounts']) {
      expect(all!.select).not.toHaveProperty(heavy);
    }
  });

  it('число по фильтрам: снятые — вместе с черновиками, «все» — сумма', async () => {
    const { svc, prisma } = setup([
      { status: 'active', n: 3000 },
      { status: 'paused', n: 900 },
      { status: 'draft', n: 100 },
      { status: 'sold_out', n: 1000 },
    ]);
    expect(await svc.countMine('s1')).toEqual({
      all: 5000,
      active: 3000,
      paused: 1000,
      sold_out: 1000,
      blocked: 0,
    });
    expect(prisma.listing.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sellerId: 's1', status: { not: 'archived' } } }),
    );
  });
});
