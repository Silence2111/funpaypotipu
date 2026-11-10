import { describe, expect, it, vi } from 'vitest';
import { ListingsService } from '../src/modules/listings/listings.service';

/**
 * Временная скидка на лот. Проверяется: цена снижается условно (одна
 * скидка за раз, два нажатия не снизят дважды), прежняя хранится отдельно;
 * пополнению, снятому лоту и цене меньше рубля — отказ; завершение раньше
 * срока и по сроку возвращает прежнюю цену и обновляет индекс; правка цены
 * во время скидки — отказ.
 */

type Row = Record<string, unknown>;

function setup(
  listing: Row | null,
  opts: { updated?: number; raw?: number; ended?: Row[]; before?: Row | null; points?: Row[] } = {},
) {
  const prisma = {
    listing: {
      findUnique: vi.fn(async () => listing),
      updateMany: vi.fn(async () => ({ count: opts.updated ?? 1 })),
    },
    // История цены — для честной прежней цены скидки.
    listingPricePoint: {
      findFirst: vi.fn(async () => opts.before ?? null),
      findMany: vi.fn(async () => opts.points ?? []),
    },
    $executeRaw: vi.fn(async () => opts.raw ?? 1),
    $queryRaw: vi.fn(async () => opts.ended ?? []),
  };
  const search = { indexListing: vi.fn(async () => undefined) };
  const svc = new ListingsService(prisma as never, search as never, {} as never, {} as never);
  return { svc, prisma, search };
}

const lot = (over: Row = {}): Row => ({
  sellerId: 's1',
  status: 'active',
  price: 150000n,
  pricePerUnits: 1,
  topupMarkupBps: null,
  saleUntil: null,
  ...over,
});
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('скидка на лот', () => {
  it('честная: от самой низкой цены за неделю; меньше 5% от неё — отказ с причиной', async () => {
    // Держалась 1 000 ₽, два дня назад подняли до 1 500 ₽.
    const raised = {
      before: { price: 100000n, pricePerUnits: 1, at: daysAgo(30) },
      points: [{ price: 150000n, pricePerUnits: 1, at: daysAgo(2) }],
    };
    // −20% от 1 500 — 1 200 ₽, дороже прежних 1 000: скидки на деле нет.
    await expect(setup(lot(), raised).svc.startSale('s1', 'l1', 20, 3)).rejects.toThrow(
      /была 1\s000 ₽ — от неё скидка 0%, а нужно от 5%/,
    );
    // −40% — 900 ₽: от честных 1 000 ₽ это −10%, её покупатель и увидит.
    const ok = setup(lot(), raised);
    expect(await ok.svc.startSale('s1', 'l1', 40, 3)).toMatchObject({
      price: '90000',
      saleListPrice: '150000',
      saleRefPrice: '100000',
    });
    const data = (ok.prisma.listing.updateMany.mock.calls[0]![0] as unknown as { data: Row }).data;
    expect(data).toMatchObject({ saleListPrice: 150000n, saleRefPrice: 100000n, price: 90000n });
  });

  it('цена ниже на процент, прежняя — отдельно, условно и с обновлением индекса', async () => {
    const { svc, prisma, search } = setup(lot());
    const before = Date.now();
    const r = await svc.startSale('s1', 'l1', 20, 3);
    expect(r).toMatchObject({ price: '120000', saleListPrice: '150000' });
    const call = prisma.listing.updateMany.mock.calls[0]![0] as unknown as {
      where: Row;
      data: { saleListPrice: bigint; price: bigint; saleUntil: Date };
    };
    expect(call.where).toEqual({ id: 'l1', sellerId: 's1', saleUntil: null, price: 150000n });
    expect(call.data.price).toBe(120000n);
    expect(call.data.saleListPrice).toBe(150000n);
    const days = (call.data.saleUntil.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(2.99);
    expect(days).toBeLessThan(3.01);
    expect(search.indexListing).toHaveBeenCalledWith('l1');
  });

  it('пополнению, снятому лоту, второй скидке, чужому и дешевле рубля — отказ', async () => {
    await expect(
      setup(lot({ topupMarkupBps: 650 })).svc.startSale('s1', 'l1', 10, 1),
    ).rejects.toThrow(/наценка/);
    await expect(setup(lot({ status: 'paused' })).svc.startSale('s1', 'l1', 10, 1)).rejects.toThrow(
      'Скидку можно дать лоту в продаже',
    );
    await expect(
      setup(lot({ saleUntil: new Date(Date.now() + 1000) })).svc.startSale('s1', 'l1', 10, 1),
    ).rejects.toThrow(/уже идёт/);
    await expect(setup(lot()).svc.startSale('other', 'l1', 10, 1)).rejects.toThrow(
      'Это не ваш лот',
    );
    await expect(setup(lot({ price: 110n })).svc.startSale('s1', 'l1', 10, 1)).rejects.toThrow(
      'Со скидкой цена меньше 1 ₽',
    );
    // Второе нажатие опоздало: цена уже снижена первым.
    await expect(setup(lot(), { updated: 0 }).svc.startSale('s1', 'l1', 10, 1)).rejects.toThrow(
      /обновите страницу/,
    );
  });

  it('завершить раньше срока — прежняя цена; скидки нет — 404', async () => {
    const { svc, prisma, search } = setup(null);
    expect(await svc.endSale('s1', 'l1')).toEqual({ ok: true });
    expect(prisma.$executeRaw.mock.calls[0]).toContain('l1');
    expect(search.indexListing).toHaveBeenCalledWith('l1');
    await expect(setup(null, { raw: 0 }).svc.endSale('s1', 'l1')).rejects.toThrow(
      'Скидки на этом лоте нет',
    );
  });

  it('срок вышел — цена возвращается, индекс обновляется; сбой индекса не мешает', async () => {
    const { svc, search, prisma } = setup(null, { ended: [{ id: 'a' }, { id: 'b' }] });
    search.indexListing.mockRejectedValueOnce(new Error('поиск недоступен'));
    expect(await svc.endExpiredSales()).toBe(2);
    expect(search.indexListing).toHaveBeenCalledTimes(2);
    // Сначала — срок без прежней цены: такая строка не должна ронять возврат остальным.
    expect(String(prisma.$executeRaw.mock.calls[0]![0])).toMatch(/sale_list_price IS NULL/);
    // Истёкшая отметка «минимум за 30 дней» уходит из сортировки снижений.
    expect(String(prisma.$executeRaw.mock.calls.at(-1)![0])).toMatch(/SET price_low_until = NULL/);
  });

  it('во время скидки новая цена или пачка — отказ', async () => {
    const current = {
      ...lot({ price: 120000n, saleUntil: new Date(Date.now() + 3600_000) }),
      categoryId: 'c1',
      fulfillmentType: 'manual',
      pricePerUnits: 1,
      category: {},
    };
    const { svc } = setup(current);
    await expect(svc.update('s1', 'l1', { price: '130000' } as never)).rejects.toThrow(
      'Идёт скидка — завершите её, потом меняйте цену',
    );
    await expect(svc.update('s1', 'l1', { pricePerUnits: 10 } as never)).rejects.toThrow(
      /Идёт скидка/,
    );
  });
});
