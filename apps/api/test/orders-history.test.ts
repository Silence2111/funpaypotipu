import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from '../src/modules/orders/orders.service';

/**
 * «Заказы» в кабинете: свои покупки или продажи новыми сверху, по
 * страницам; поиск — по номеру, лоту и нику другой стороны; страница дальше
 * — от последнего показанного, чужой заказ курсором не принимается.
 */

type Where = Record<string, unknown>;
const HOUR = 3600_000;
const NOW = Date.now();

function order(n: number, buyerId: string, sellerId: string) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    publicNumber: `GM-${n}`,
    buyerId,
    sellerId,
    status: 'completed',
    createdAt: new Date(NOW - n * HOUR),
    listingSnapshot: { title: `Лот ${n}` },
    buyer: { profile: { username: `nick_${buyerId}` } },
    seller: { profile: { username: `nick_${sellerId}` } },
  };
}

function setup(rows: ReturnType<typeof order>[]) {
  const calls: Where[] = [];
  const prisma = {
    order: {
      findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) => {
        calls.push(where);
        return rows.slice(0, take);
      }),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; sellerId?: string; buyerId?: string } }) => {
          const r = rows.find((o) => o.id === where.id);
          if (!r) return null;
          if (where.sellerId && r.sellerId !== where.sellerId) return null;
          if (where.buyerId && r.buyerId !== where.buyerId) return null;
          return { id: r.id, createdAt: r.createdAt };
        },
      ),
    },
  };
  const none = {} as never;
  const svc = new OrdersService(prisma as never, none, none, none, none, none, none, none, none);
  return { svc, calls };
}

describe('история заказов', () => {
  it('продажи по страницам: ник покупателя, лот из снимка, дальше — по последнему', async () => {
    const rows = [1, 2, 3].map((n) => order(n, `b${n}`, 'me'));
    const { svc, calls } = setup(rows);

    const first = await svc.history('me', { role: 'seller', limit: 2 });
    expect(first.items.map((o) => [o.publicNumber, o.role, o.counterparty, o.title])).toEqual([
      ['GM-1', 'seller', 'nick_b1', 'Лот 1'],
      ['GM-2', 'seller', 'nick_b2', 'Лот 2'],
    ]);
    expect(first.next).toBe(rows[1]!.id);
    expect(calls[0]).toEqual({ sellerId: 'me' });

    await svc.history('me', { role: 'seller', limit: 2, before: first.next! });
    expect(calls[1]).toMatchObject({
      sellerId: 'me',
      AND: [
        {
          OR: [
            { createdAt: { lt: rows[1]!.createdAt } },
            { createdAt: rows[1]!.createdAt, id: { lt: rows[1]!.id } },
          ],
        },
      ],
    });
  });

  it('поиск — номер, лот или ник продавца у покупок; «#» и «@» впереди не мешают', async () => {
    const { svc, calls } = setup([order(1, 'me', 's1')]);
    const r = await svc.history('me', {
      role: 'buyer',
      q: '  @Nick_s1 ',
      days: 30,
      status: ['completed'],
    });
    expect(r.next).toBeNull();
    const like = { contains: 'Nick_s1', mode: 'insensitive' };
    expect(calls[0]).toMatchObject({
      buyerId: 'me',
      status: { in: ['completed'] },
      OR: [
        { publicNumber: like },
        { listing: { title: like } },
        { seller: { profile: { username: like } } },
      ],
    });
    const since = (calls[0]!.createdAt as { gte: Date }).gte.getTime();
    expect(Math.abs(since - (Date.now() - 30 * 24 * HOUR))).toBeLessThan(5000);
  });

  it('курсор — только свой заказ этой стороны', async () => {
    const rows = [order(1, 'b1', 'me'), order(2, 'me', 's2')];
    const { svc } = setup(rows);
    // Свою покупку нельзя подставить курсором в продажи.
    await expect(svc.history('me', { role: 'seller', before: rows[1]!.id })).rejects.toThrow(
      'Список заказов устарел',
    );
  });
});
