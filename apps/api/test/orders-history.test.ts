import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from '../src/modules/orders/orders.service';

/**
 * «Заказы» в кабинете: свои покупки или продажи новыми сверху, по
 * страницам; поиск — по номеру, лоту и нику другой стороны (отдельным
 * запросом по триграммным индексам); страница дальше — от последнего
 * показанного, чужой заказ курсором не принимается.
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

type Sql = { text: string; values: unknown[] };

function setup(rows: ReturnType<typeof order>[], found: string[] = []) {
  const calls: Where[] = [];
  const raw: Sql[] = [];
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $queryRaw: vi.fn(async (q: Sql | TemplateStringsArray) => {
      // Первый запрос транзакции — настройка плана, дальше — сам поиск.
      if (!('text' in q)) return [];
      raw.push(q);
      return found.map((id) => ({ id }));
    }),
    order: {
      findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) => {
        calls.push(where);
        const ids = (where.id as { in?: string[] } | undefined)?.in;
        return (ids ? rows.filter((r) => ids.includes(r.id)) : rows).slice(0, take);
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
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const r = rows.find((o) => o.id === where.id);
        return r ? { ...r, conversation: { id: `conv-${r.id}` } } : null;
      }),
    },
  };
  const none = {} as never;
  const svc = new OrdersService(prisma as never, none, none, none, none, none, none, none, none);
  return { svc, calls, raw, prisma };
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

  it('поиск — номер, лот из заказа или ник продавца у покупок; «#» и «@» впереди не мешают; «_» — обычный знак', async () => {
    const rows = [order(1, 'me', 's1')];
    const { svc, calls, raw, prisma } = setup(rows, [rows[0]!.id]);
    const r = await svc.history('me', {
      role: 'buyer',
      q: '  @Nick_s1 ',
      days: 30,
      status: ['completed'],
    });
    expect(r.items.map((o) => o.publicNumber)).toEqual(['GM-1']);
    expect(r.next).toBeNull();
    // Строки — по найденным id, в том же порядке «новые сверху».
    expect(calls[0]).toEqual({ id: { in: [rows[0]!.id] } });

    const [q] = raw;
    const sql = q!.text.replace(/\s+/g, ' ');
    // Три ветки: номер, название из снимка в заказе (а не нынешнее
    // название лота) и ник продавца; у каждой — своя страница.
    expect(sql).toContain('o.public_number ILIKE');
    expect(sql).toContain(`(o.listing_snapshot ->> 'title') ILIKE`);
    expect(sql).toContain('JOIN profiles p ON p.user_id = o.seller_id');
    expect(sql).toContain('o.buyer_id = $1::uuid');
    expect(sql.match(/UNION/g)).toHaveLength(2);
    expect(q!.values).toContain('%Nick\\_s1%');
    expect(q!.values).toContainEqual(['completed']);
    expect(q!.values).toContain(31);
    // План — под этот текст поиска, а не общий план подготовленного запроса.
    const setup0 = prisma.$queryRaw.mock.calls[0]![0] as TemplateStringsArray;
    expect(setup0.join('')).toContain("set_config('plan_cache_mode', 'force_custom_plan', true)");
    const since = q!.values.find((v) => typeof v === 'string' && /^\d{4}-/.test(v)) as string;
    expect(Math.abs(Date.parse(since) - (Date.now() - 30 * 24 * HOUR))).toBeLessThan(5000);
  });

  it('поиск со следующей страницы — от последнего показанного; у продаж — ник покупателя', async () => {
    const rows = [order(1, 'b1', 'me'), order(2, 'b2', 'me')];
    const { svc, raw } = setup(rows);
    const r = await svc.history('me', { role: 'seller', q: 'лот', before: rows[0]!.id, limit: 1 });
    expect(r.items).toEqual([]);
    const sql = raw[0]!.text.replace(/\s+/g, ' ');
    expect(sql).toContain('o.seller_id = $1::uuid');
    expect(sql).toContain('JOIN profiles p ON p.user_id = o.buyer_id');
    expect(sql).toContain(
      '(o.created_at, o.id) < (SELECT c.created_at, c.id FROM orders c WHERE c.id =',
    );
    expect(raw[0]!.values).toContain(rows[0]!.id);
    expect(raw[0]!.values).toContain(2);
  });

  it('короткий список: обзору кабинета — пять последних, без limit — до 200', async () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => order(n, 'b1', 'me'));
    const { svc, prisma } = setup(rows);
    expect(
      (await svc.listMine('me', { role: 'seller', limit: 5 })).map((o) => o.publicNumber),
    ).toEqual(['GM-1', 'GM-2', 'GM-3', 'GM-4', 'GM-5']);
    await svc.listMine('me');
    const takes = prisma.order.findMany.mock.calls.map((c) => (c[0] as { take: number }).take);
    expect(takes).toEqual([5, 200]);
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

describe('страница заказа', () => {
  it('с id диалога сделки — страница не ищет его в обрезанном списке мессенджера; чужой — нет', async () => {
    const rows = [order(1, 'b1', 'me')];
    const { svc } = setup(rows);
    const got = await svc.getForUser(rows[0]!.id, 'me');
    expect(got).toMatchObject({ id: rows[0]!.id, conversationId: `conv-${rows[0]!.id}` });
    expect(got).not.toHaveProperty('conversation');
    await expect(svc.getForUser(rows[0]!.id, 'stranger')).rejects.toThrow('Нет доступа к заказу');
  });
});
