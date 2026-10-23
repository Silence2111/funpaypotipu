import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListingsService } from '../src/modules/listings/listings.service';

/**
 * Выдача раздела: фильтры по параметрам и продавец в строке.
 *
 * Параметр «да/нет» (Prime-статус) лежит в лоте булевым. Фильтр раньше
 * пропускал только строки, и «только с Prime» молча показывал все лоты.
 *
 * Prisma подменена: проверяется, какой запрос уходит в базу.
 */

type Where = { AND?: unknown };

function setup(rows: unknown[] = []) {
  const prisma = {
    listing: {
      findMany: vi.fn(async (_args: { where: Where }) => rows),
      count: vi.fn(async (_args: { where: Where }) => rows.length),
    },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  const search = { enabled: false };
  const svc = new ListingsService(prisma as never, search as never, {} as never, {} as never);
  return { svc, prisma };
}

const QUERY = { page: 1, limit: 50, sort: 'new' as const };

beforeEach(() => vi.clearAllMocks());

describe('фильтр по параметрам раздела', () => {
  it('«да/нет» уходит в базу булевым, значение списка — строкой', async () => {
    const { svc, prisma } = setup();
    await svc.browse({ ...QUERY, attrs: JSON.stringify({ prime: true, rank: 'Gold Nova' }) });
    expect(prisma.listing.findMany.mock.calls[0]![0].where.AND).toEqual([
      { attributes: { path: ['prime'], equals: true } },
      { attributes: { path: ['rank'], equals: 'Gold Nova' } },
    ]);
  });

  it('чужие ключи, пустые и числовые значения до запроса не доходят', async () => {
    const { svc, prisma } = setup();
    await svc.browse({ ...QUERY, attrs: JSON.stringify({ 'rank"]': 'x', region: '', level: 5 }) });
    expect(prisma.listing.findMany.mock.calls[0]![0].where.AND).toBeUndefined();
  });
});

describe('продавец в строке выдачи', () => {
  it('аватар и фото из хранилища отдаются адресами', async () => {
    const { svc } = setup([
      {
        id: 'l1',
        images: ['listings/s1/a.png'],
        seller: { id: 's1', profile: { username: 'seller', avatarUrl: 'avatars/s1.png', ratingCount: 3 } },
      },
    ]);
    const res = await svc.browse(QUERY);
    const item = res.items[0] as unknown as { images: string[]; seller: { profile: { avatarUrl: string } } };
    expect(item.seller.profile.avatarUrl).toMatch(/\/api\/assets\?key=avatars%2Fs1\.png$/);
    expect(item.images[0]).toMatch(/\/api\/assets\?key=listings%2Fs1%2Fa\.png$/);
  });
});
