import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

/**
 * Страница «Уведомления»: вся история новыми сверху, дальше — по последнему
 * показанному, фильтр по группе и «только непрочитанные», счётчики по
 * группам; «Прочитать все» — в выбранной группе. Сообщения живут в
 * мессенджере и сюда не входят.
 */

type Row = {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
};
type Where = Record<string, unknown>;

const T0 = Date.parse('2026-10-27T10:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Простые условия Prisma, которыми пользуется сервис. */
function fits(r: Row, where: Where): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Where[]).some((w) => fits(r, w));
    const value = r[k as keyof Row];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const c = v as { in?: string[]; not?: string; lt?: Date | string };
      if (c.in) return c.in.includes(value as string);
      if (c.not !== undefined) return value !== c.not;
      if (c.lt instanceof Date) return (value as Date).getTime() < c.lt.getTime();
      if (typeof c.lt === 'string') return (value as string) < c.lt;
      return true;
    }
    if (v instanceof Date) return (value as Date).getTime() === v.getTime();
    return (value ?? null) === v;
  });
}

function setup() {
  const rows: Row[] = [];
  let n = 0;
  const add = (userId: string, type: string, read = false) => {
    n += 1;
    rows.push({
      id: id(n),
      userId,
      type,
      payload: { n },
      readAt: read ? new Date(T0) : null,
      createdAt: new Date(T0 + n * 1000),
    });
  };
  const newest = (a: Row, b: Row) =>
    b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);
  const prisma = {
    notification: {
      findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) =>
        rows
          .filter((r) => fits(r, where))
          .sort(newest)
          .slice(0, take),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Where }) => rows.find((r) => fits(r, where)) ?? null,
      ),
      groupBy: vi.fn(async ({ where }: { where: Where }) => {
        const counts = new Map<string, number>();
        for (const r of rows.filter((x) => fits(x, where))) {
          counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
        }
        return [...counts].map(([type, count]) => ({ type, _count: { _all: count } }));
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const hit = rows.filter((r) => fits(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
    },
  };
  const svc = new NotificationsService(
    prisma as never,
    { enabled: false } as never,
    { enabled: false } as never,
    { enabled: false } as never,
  );
  return { svc, rows, add };
}

describe('страница «Уведомления»', () => {
  it('новые сверху, дальше — по последнему показанному; новое между запросами не сдвигает список; сообщений нет', async () => {
    const { svc, add } = setup();
    add('u1', 'order_paid'); // 1
    add('u1', 'new_message'); // 2 — в мессенджере
    add('u1', 'dispute_opened'); // 3
    add('u2', 'order_paid'); // 4 — чужое
    add('u1', 'review_received'); // 5
    add('u1', 'new_login'); // 6

    const first = await svc.history('u1', { limit: 2 });
    expect(first.items.map((r) => r.type)).toEqual(['new_login', 'review_received']);
    expect(first.next).toBe(id(5));

    add('u1', 'price_drop'); // 7 — пришло, пока человек листал
    const second = await svc.history('u1', { limit: 2, before: first.next! });
    expect(second.items.map((r) => r.type)).toEqual(['dispute_opened', 'order_paid']);
    expect(second.next).toBeNull();
    expect(second.unread).toEqual({
      total: 5,
      groups: { orders: 1, disputes: 1, reviews: 1, security: 1, searches: 1 },
    });
  });

  it('группа и «только непрочитанные»; неизвестная группа, чужой и битый курсор — отказ', async () => {
    const { svc, add } = setup();
    add('u1', 'order_paid', true);
    add('u1', 'order_delivered');
    add('u1', 'dispute_reply_soon');
    add('u2', 'order_created');

    const orders = await svc.history('u1', { group: 'orders' });
    expect(orders.items.map((r) => r.type)).toEqual(['order_delivered', 'order_paid']);
    const unread = await svc.history('u1', { group: 'orders', unread: true });
    expect(unread.items.map((r) => r.type)).toEqual(['order_delivered']);
    const disputes = await svc.history('u1', { group: 'disputes', unread: true });
    expect(disputes.items.map((r) => r.type)).toEqual(['dispute_reply_soon']);

    await expect(svc.history('u1', { group: 'messages' })).rejects.toThrow(/Нет такой группы/);
    await expect(svc.history('u1', { group: 'nope' })).rejects.toThrow(/Нет такой группы/);
    await expect(svc.history('u1', { before: id(4) })).rejects.toThrow(/устарел/);
    await expect(svc.history('u1', { before: 'not-a-uuid' })).rejects.toThrow(/устарел/);
  });

  it('«Прочитать все» в группе — только её; без группы — всё, кроме сообщений и чужого', async () => {
    const { svc, rows, add } = setup();
    add('u1', 'order_paid');
    add('u1', 'dispute_opened');
    add('u1', 'new_message');
    add('u2', 'order_paid');

    const r = await svc.markAllRead('u1', 'orders');
    expect(r.unread).toEqual({ total: 1, groups: { disputes: 1 } });
    expect(rows.filter((x) => !x.readAt).map((x) => `${x.userId}:${x.type}`)).toEqual([
      'u1:dispute_opened',
      'u1:new_message',
      'u2:order_paid',
    ]);

    await svc.markAllRead('u1');
    expect(rows.filter((x) => !x.readAt).map((x) => `${x.userId}:${x.type}`)).toEqual([
      'u1:new_message',
      'u2:order_paid',
    ]);
    await expect(svc.markAllRead('u1', 'nope')).rejects.toThrow(/Нет такой группы/);
  });
});
