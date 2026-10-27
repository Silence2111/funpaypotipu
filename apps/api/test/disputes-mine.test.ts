import { describe, expect, it, vi } from 'vitest';
import { DisputesService } from '../src/modules/disputes/disputes.service';

/**
 * «Споры» в кабинете: свои споры как покупателя и как продавца, со своей
 * стороны; открытые — где ход за мной, с ближайшим сроком, наверху;
 * закрытые — отдельно, свежие сверху; чужие не видны.
 */

type Order = { id: string; buyerId: string; sellerId: string; publicNumber: string };
type Row = {
  id: string;
  status: string;
  reason: string;
  awaitingFrom: string | null;
  respondBy: Date | null;
  missedBy: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  order: Order & { amount: bigint; currency: string; listingSnapshot: { title: string } };
};
type Where = Record<string, unknown>;

const HOUR = 3600_000;
const NOW = Date.now();

const part = (order: Row['order'], where: Where) =>
  Object.entries(where).every(([k, v]) => order[k as keyof Order] === v);

/** Условия, которыми пользуется mine(): участник заказа, статус, чей ход. */
function fits(r: Row, where: Where): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'order') {
      const { OR } = v as { OR?: Where[] };
      return OR ? OR.some((w) => part(r.order, w)) : part(r.order, v as Where);
    }
    if (k === 'OR') return (v as Where[]).some((w) => fits(r, w));
    if (k === 'status') {
      const c = v as { in?: string[]; notIn?: string[] };
      return c.in ? c.in.includes(r.status) : !c.notIn!.includes(r.status);
    }
    return r[k as keyof Row] === v;
  });
}

function setup() {
  const rows: Row[] = [];
  const add = (n: number, buyerId: string, sellerId: string, extra: Partial<Row> = {}) => {
    rows.push({
      id: `d${n}`,
      status: 'open',
      reason: `Причина ${n}`,
      awaitingFrom: null,
      respondBy: null,
      missedBy: null,
      createdAt: new Date(NOW - (10 - n) * HOUR),
      resolvedAt: null,
      order: {
        id: `o${n}`,
        buyerId,
        sellerId,
        publicNumber: `GM-${n}`,
        amount: 100000n,
        currency: 'RUB',
        listingSnapshot: { title: `Лот ${n}` },
      },
      ...extra,
    });
  };
  const prisma = {
    dispute: {
      findMany: vi.fn(async ({ where, orderBy }: { where: Where; orderBy: Where | Where[] }) => {
        const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).map((o) => Object.keys(o)[0]!);
        const at = (r: Row, k: string) => (r[k as keyof Row] as Date | null)?.getTime() ?? 0;
        return rows
          .filter((r) => fits(r, where))
          .sort((a, b) => keys.reduce((d, k) => d || at(b, k) - at(a, k), 0));
      }),
      count: vi.fn(
        async ({ where }: { where: Where }) => rows.filter((r) => fits(r, where)).length,
      ),
    },
    profile: {
      findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
        where.userId.in.map((userId) => ({ userId, username: `nick_${userId}` })),
      ),
    },
  };
  const svc = new DisputesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, add };
}

describe('мои споры', () => {
  it('свои — со своей стороны; ход за мной — наверх, ближайший срок первым; чужих нет', async () => {
    const { svc, add } = setup();
    add(1, 'me', 'sel1', { awaitingFrom: 'seller', respondBy: new Date(NOW + 20 * HOUR) });
    add(2, 'buy2', 'me', { awaitingFrom: 'seller', respondBy: new Date(NOW + 9 * HOUR) });
    add(3, 'me', 'sel3', {
      awaitingFrom: 'buyer',
      respondBy: new Date(NOW + 2 * HOUR),
      status: 'in_review',
    });
    add(4, 'buy4', 'sel4', { awaitingFrom: 'buyer', respondBy: new Date(NOW + HOUR) });
    add(5, 'me', 'sel5', { status: 'resolved_buyer', resolvedAt: new Date(NOW) });

    const r = await svc.mine('me');
    expect(r.items.map((d) => [d.id, d.side, d.myTurn])).toEqual([
      ['d3', 'buyer', true],
      ['d2', 'seller', true],
      ['d1', 'buyer', false],
    ]);
    expect(r.items[1]).toMatchObject({
      counterpart: 'nick_buy2',
      order: { publicNumber: 'GM-2', title: 'Лот 2' },
      reason: 'Причина 2',
    });
    expect(r.counts).toEqual({ open: 3, closed: 1, myTurn: 2 });
  });

  it('закрытые — отдельно, свежие сверху; ход в закрытом не считается', async () => {
    const { svc, add } = setup();
    // Открыт раньше, а закрыт позже — сверху.
    add(1, 'me', 's', { status: 'resolved_seller', resolvedAt: new Date(NOW - HOUR) });
    add(2, 'b', 'me', {
      status: 'cancelled',
      resolvedAt: new Date(NOW - 5 * HOUR),
      awaitingFrom: 'seller',
    });
    add(3, 'me', 's', { status: 'open' });

    const r = await svc.mine('me', 'closed');
    expect(r.items.map((d) => [d.id, d.myTurn])).toEqual([
      ['d1', false],
      ['d2', false],
    ]);
    expect(r.counts).toEqual({ open: 1, closed: 2, myTurn: 0 });
  });
});
