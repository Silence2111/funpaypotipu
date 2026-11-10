import { describe, expect, it, vi } from 'vitest';
import { DisputesService } from '../src/modules/disputes/disputes.service';

/**
 * Очередь арбитра в консоли. Раньше открытые споры грузились все разом, а
 * решённых не было вовсе. Теперь — страницы: открытые с пропустившими срок
 * сверху, решённые — по времени решения; поиск по номеру, лоту и никам
 * сторон; счётчики открытых, пропустивших срок и решённых.
 */

type Sql = { text: string; values: unknown[] };
const at = (h: number) => new Date(Date.UTC(2026, 10, 4, h));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup(page: Array<{ id: string; missed: boolean; at: Date }>) {
  const raw: Sql[] = [];
  const prisma = {
    $queryRaw: vi.fn(async (q: Sql | TemplateStringsArray) => {
      const text = 'text' in q ? q.text : q.join('?');
      if ('text' in q) raw.push(q);
      if (text.includes('FILTER')) return [{ open: 40, missed: 3, closed: 7 }];
      return page;
    }),
    dispute: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        [...where.id.in].reverse().map((id) => ({
          id,
          arbiterId: null,
          missedBy: null,
          order: {
            publicNumber: 'GM-1',
            amount: 100n,
            currency: 'RUB',
            buyerId: 'b',
            sellerId: 's',
            listingSnapshot: { title: 'Лот' },
          },
          _count: { messages: 2 },
        })),
      ),
    },
    profile: {
      findMany: vi.fn(async () => [
        { userId: 'b', username: 'buyer' },
        { userId: 's', username: 'seller' },
      ]),
    },
  };
  const none = {} as never;
  const svc = new DisputesService(prisma as never, none, none, none, none, none);
  return { svc, raw };
}

describe('очередь арбитра', () => {
  it('открытые — пропустившие срок сверху, затем от старых; next помнит, пропустил ли последний', async () => {
    const page = [
      { id: uid(1), missed: true, at: at(1) },
      { id: uid(2), missed: true, at: at(2) },
      { id: uid(3), missed: false, at: at(0) },
    ];
    const { svc, raw } = setup(page);
    const res = await svc.queue({ limit: 2 });
    expect(res.items.map((d) => d.id)).toEqual([uid(1), uid(2)]); // порядок — как у базы
    expect(res.items[0]).toMatchObject({ buyer: 'buyer', seller: 'seller', messages: 2 });
    expect(res.next).toBe(`m${at(2).toISOString()}_${uid(2)}`);
    expect(res.counts).toEqual({ open: 40, missed: 3, closed: 7 });
    expect(raw[0]!.text).toContain('ORDER BY d.missed_by IS NULL, d.created_at, d.id');
  });

  it('следующая страница открытых — после последнего показанного с тем же признаком', async () => {
    const { svc, raw } = setup([]);
    await svc.queue({ cursor: { missed: true, at: at(2), id: uid(2) } });
    expect(raw[0]!.text).toContain('(d.missed_by IS NULL, d.created_at, d.id) >');
    // у пропустившего срок «missed_by IS NULL» — ложь
    expect(raw[0]!.values).toEqual(expect.arrayContaining([false, at(2).toISOString(), uid(2)]));
  });

  it('решённые — свежие решения сверху; поиск — номер, лот и ники сторон, «#» впереди не мешает', async () => {
    const { svc, raw } = setup([{ id: uid(9), missed: false, at: at(9) }]);
    const res = await svc.queue({ state: 'closed', q: ' #GM-1 ' });
    expect(res.next).toBeNull();
    const page = raw.find((q) => q.text.includes('LIMIT'))!;
    expect(page.text).toContain('ORDER BY d.resolved_at DESC NULLS LAST, d.id DESC');
    expect(page.text).toContain('o.public_number ILIKE');
    expect(page.text).toContain("(o.listing_snapshot ->> 'title') ILIKE");
    expect(page.text).toContain(
      'o.buyer_id IN (SELECT p.user_id FROM profiles p WHERE p.username ILIKE',
    );
    expect(page.values).toContain('%GM-1%');
  });
});
