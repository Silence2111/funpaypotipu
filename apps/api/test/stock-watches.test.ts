import { describe, expect, it, vi } from 'vitest';
import {
  MAX_STOCK_WATCHES,
  StockWatchesService,
} from '../src/modules/stock-watches/stock-watches.service';

/**
 * «Сообщить о поступлении». Проверяется: ждать можно только закончившийся
 * чужой лот, повтор — без второй записи, не больше предела; проход —
 * уведомление о каждом лоте снова в продаже и удаление ожидания до него,
 * чужим экземпляром API уже удалённое — молчит.
 */

type Row = Record<string, unknown>;

function setup(
  opts: {
    listing?: Row | null;
    existing?: Row | null;
    count?: number;
    rows?: Row[];
    deleted?: number;
  } = {},
) {
  const prisma = {
    listing: {
      findUnique: vi.fn(async () =>
        opts.listing === undefined ? { status: 'sold_out', sellerId: 's1' } : opts.listing,
      ),
    },
    stockWatch: {
      findUnique: vi.fn(async () => opts.existing ?? null),
      count: vi.fn(async () => opts.count ?? 0),
      createMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: opts.deleted ?? 1 })),
    },
    $queryRaw: vi.fn(async () => opts.rows ?? []),
    $executeRaw: vi.fn(async () => 0),
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  return {
    svc: new StockWatchesService(prisma as never, notifications as never),
    prisma,
    notifications,
  };
}

describe('ожидание поступления', () => {
  it('только закончившийся чужой лот; повтор — без второй записи; не больше предела', async () => {
    await expect(setup({ listing: null }).svc.watch('u1', 'l1')).rejects.toThrow('Лот не найден');
    await expect(
      setup({ listing: { status: 'paused', sellerId: 's1' } }).svc.watch('u1', 'l1'),
    ).rejects.toThrow('Лот не найден');
    await expect(setup().svc.watch('s1', 'l1')).rejects.toThrow('Это ваш лот');
    await expect(
      setup({ listing: { status: 'active', sellerId: 's1' } }).svc.watch('u1', 'l1'),
    ).rejects.toThrow(/можно купить сейчас/);
    const again = setup({ existing: { id: 'w1' } });
    expect(await again.svc.watch('u1', 'l1')).toEqual({ watching: true });
    expect(again.prisma.stockWatch.createMany).not.toHaveBeenCalled();
    await expect(setup({ count: MAX_STOCK_WATCHES }).svc.watch('u1', 'l1')).rejects.toThrow(
      /не больше/,
    );
    const fresh = setup();
    expect(await fresh.svc.watch('u1', 'l1')).toEqual({ watching: true });
    expect(fresh.prisma.stockWatch.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', listingId: 'l1' }],
      skipDuplicates: true,
    });
  });

  it('снова в продаже — уведомление и ожидание удалено до него; удалённое другим — молчит', async () => {
    const rows = [
      { id: 'w1', user_id: 'u1', listing_id: 'l1', title: 'Золото', locale: 'ru' },
      { id: 'w2', user_id: 'u2', listing_id: 'l1', title: 'Золото', locale: 'en' },
    ];
    const { svc, prisma, notifications } = setup({ rows });
    expect(await svc.sweep()).toEqual({ notified: 2 });
    expect(prisma.stockWatch.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: 'w1' } });
    expect(notifications.notify.mock.calls.map((c) => [c[0], c[1], (c[2] as Row).preview])).toEqual(
      [
        ['u1', 'back_in_stock', '«Золото» снова в продаже'],
        ['u2', 'back_in_stock', '“Золото” is back in stock'],
      ],
    );
    expect(notifications.notify.mock.calls[0]![2]).toMatchObject({ listingId: 'l1' });

    const late = setup({ rows: rows.slice(0, 1), deleted: 0 });
    expect(await late.svc.sweep()).toEqual({ notified: 0 });
    expect(late.notifications.notify).not.toHaveBeenCalled();
  });
});
