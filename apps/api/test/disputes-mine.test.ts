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
/** id спора — UUID, как в базе; в проверках — коротко: d1, d2… */
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const short = (id: string | null) => (id ? `d${Number(id.slice(-12))}` : null);
const ids = (r: { items: Array<{ id: string }> }) => r.items.map((d) => short(d.id));

const part = (order: Row['order'], where: Where) =>
  Object.entries(where).every(([k, v]) => order[k as keyof Order] === v);

const time = (v: unknown) => (v instanceof Date ? v.getTime() : v);

/**
 * Условия, которыми пользуется mine(): участник заказа, статус, чей ход,
 * список id и курсор «раньше этого» (lt по дате и id, пустая дата).
 */
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
    const own = time(r[k as keyof Row]);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const c = v as { in?: string[]; lt?: unknown };
      if (c.in) return c.in.includes(own as string);
      return own != null && (own as number | string) < (time(c.lt) as number | string);
    }
    return own === time(v);
  });
}

/** orderBy mine(): поле по убыванию; у пустых дат — nulls: 'last'. */
function sorter(orderBy: Where | Where[] | undefined) {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map(
    (o) => Object.keys(o)[0]!,
  );
  return (a: Row, b: Row) =>
    keys.reduce((d, k) => {
      if (d) return d;
      const x = time(a[k as keyof Row]) as number | string | null;
      const y = time(b[k as keyof Row]) as number | string | null;
      if (x === y) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return x < y ? 1 : -1;
    }, 0);
}

function setup() {
  const rows: Row[] = [];
  const add = (n: number, buyerId: string, sellerId: string, extra: Partial<Row> = {}) => {
    rows.push({
      id: uid(n),
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
      findMany: vi.fn(
        async ({
          where,
          orderBy,
          take,
        }: {
          where: Where;
          orderBy?: Where | Where[];
          take?: number;
        }) =>
          rows
            .filter((r) => fits(r, where))
            .sort(sorter(orderBy))
            .slice(0, take ?? rows.length),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Where }) => rows.find((r) => fits(r, where)) ?? null,
      ),
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
    expect(r.items.map((d) => [short(d.id), d.side, d.myTurn])).toEqual([
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
    expect(r.items.map((d) => [short(d.id), d.myTurn])).toEqual([
      ['d1', false],
      ['d2', false],
    ]);
    expect(r.counts).toEqual({ open: 1, closed: 2, myTurn: 0 });
  });

  it('открытые по страницам: тот же порядок, что разом; курсор — после последнего показанного', async () => {
    const { svc, add } = setup();
    // Ход за мной: d6 (срок через 3 ч), d2 (через 5 ч); дальше — новые сверху.
    add(1, 'me', 's1');
    add(2, 'b2', 'me', { awaitingFrom: 'seller', respondBy: new Date(NOW + 5 * HOUR) });
    add(3, 'me', 's3', { awaitingFrom: 'seller', respondBy: new Date(NOW + HOUR) });
    add(4, 'me', 's4');
    add(5, 'me', 's5', { status: 'in_review' });
    add(6, 'me', 's6', { awaitingFrom: 'buyer', respondBy: new Date(NOW + 3 * HOUR) });

    const all = ids(await svc.mine('me', 'open', { limit: 100 }));
    expect(all).toEqual(['d6', 'd2', 'd3', 'd5', 'd4', 'd1']);

    const seen: string[] = [];
    let before: string | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await svc.mine('me', 'open', { limit: 2, before });
      seen.push(...ids(page));
      if (!page.next) break;
      expect(page.next).toBe(page.items.at(-1)!.id);
      before = page.next;
    }
    expect(seen).toEqual(all);
  });

  it('спор-курсор закрылся, пока листали, — следующая страница без повторов и пропусков', async () => {
    const { svc, add } = setup();
    add(1, 'me', 's1');
    add(2, 'me', 's2');
    add(3, 'me', 's3');
    const first = await svc.mine('me', 'open', { limit: 2 });
    expect(ids(first)).toEqual(['d3', 'd2']);
    // d2 решили, пока человек смотрел первую страницу.
    const { svc: svc2, add: add2 } = setup();
    add2(1, 'me', 's1');
    add2(2, 'me', 's2', { status: 'resolved_buyer', resolvedAt: new Date(NOW) });
    add2(3, 'me', 's3');
    const rest = await svc2.mine('me', 'open', { limit: 2, before: first.next! });
    expect(ids(rest)).toEqual(['d1']);
    expect(rest.next).toBeNull();
  });

  it('закрытые по страницам — по времени решения; без даты решения — в конце', async () => {
    const { svc, add } = setup();
    add(1, 'me', 's', { status: 'resolved_seller', resolvedAt: new Date(NOW - 3 * HOUR) });
    add(2, 'me', 's', { status: 'cancelled', resolvedAt: new Date(NOW - HOUR) });
    add(3, 'me', 's', { status: 'resolved_buyer', resolvedAt: null });
    add(4, 'me', 's', { status: 'resolved_buyer', resolvedAt: new Date(NOW - 2 * HOUR) });

    const p1 = await svc.mine('me', 'closed', { limit: 2 });
    const p2 = await svc.mine('me', 'closed', { limit: 2, before: p1.next! });
    expect([ids(p1), short(p1.next)]).toEqual([['d2', 'd4'], 'd4']);
    expect([ids(p2), short(p2.next)]).toEqual([['d1', 'd3'], null]);
  });

  it('чужой или неизвестный курсор — 400', async () => {
    const { svc, add } = setup();
    add(1, 'me', 's1');
    add(2, 'other', 's2');
    await expect(svc.mine('me', 'open', { before: uid(2) })).rejects.toThrow(
      'Список споров устарел',
    );
    await expect(svc.mine('me', 'open', { before: 'не-id' })).rejects.toThrow(
      'Список споров устарел',
    );
  });
});
