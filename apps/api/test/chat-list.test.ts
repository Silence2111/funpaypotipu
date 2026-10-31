import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatService } from '../src/modules/chat/chat.service';

/**
 * Мессенджер: список диалогов и история.
 *
 * Список раньше отдавал голые строки диалогов — сайт писал «Диалог по
 * сделке» без имени собеседника и текста, а потом — только 200 последних:
 * у продавца с тысячами заказов старая переписка не открывалась и не
 * находилась поиском. История брала первые сто сообщений, и в долгой
 * переписке свежие не доходили до экрана.
 */

const now = new Date('2026-10-18T12:00:00Z');

type Sql = { text: string; values: unknown[] };

function setup(page: string[] = ['c1', 'c2']) {
  const raw: Sql[] = [];
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    conversation: {
      findUnique: vi.fn(async () => ({ id: 'c1', buyerId: 'me', sellerId: 's1', orderId: null })),
      findMany: vi.fn(async (args: { where: { id?: { in?: string[] } } }) =>
        [
          {
            id: 'c1',
            orderId: 'o1',
            buyerId: 'me',
            sellerId: 's1',
            lastMessageAt: now,
            createdAt: now,
            order: { publicNumber: 'GM-1', status: 'paid', listingSnapshot: { title: 'Аккаунт CS2' } },
          },
          { id: 'c2', orderId: null, buyerId: 'b2', sellerId: 'me', lastMessageAt: null, createdAt: now, order: null },
        ].filter((c) => !args.where.id?.in || args.where.id.in.includes(c.id)),
      ),
    },
    message: {
      groupBy: vi.fn(async () => [{ conversationId: 'c1', _count: { _all: 2 } }]),
      findMany: vi.fn(async (_args: { where: unknown; orderBy: unknown; take: number }) => [
        { id: 'm3', conversationId: 'c1', senderId: 's1', body: 'c', bodyMasked: null, isFlagged: false, attachments: [], createdAt: now, readAt: null },
        { id: 'm2', conversationId: 'c1', senderId: 'me', body: 'b', bodyMasked: null, isFlagged: false, attachments: [], createdAt: now, readAt: now },
      ]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $queryRaw: vi.fn(async (q: Sql | TemplateStringsArray) => {
      // Страница списка — Prisma.sql; последние сообщения и настройка плана — шаблоном.
      if ('text' in q) {
        raw.push(q);
        return page.map((id) => ({ id }));
      }
      if (!q.join('').includes('DISTINCT ON')) return [];
      return [
        { conversation_id: 'c1', sender_id: 's1', type: 'text', body: 'пиши в тг @me', body_masked: 'пиши в тг ***', created_at: now },
        { conversation_id: 'c2', sender_id: 'b2', type: 'attachment', body: '', body_masked: null, created_at: now },
      ];
    }),
    profile: {
      findMany: vi.fn(async () => [
        { userId: 's1', username: 'seller', avatarUrl: 'avatars/s1.png', onlineAt: now },
        { userId: 'b2', username: 'buyer2', avatarUrl: null, onlineAt: null },
      ]),
    },
  };
  const svc = new ChatService(prisma as never, {} as never, { enabled: false } as never, {} as never, {} as never);
  return { svc, prisma, raw };
}

beforeEach(() => vi.clearAllMocks());

describe('список диалогов', () => {
  it('собеседник, заказ, непрочитанные и превью — замаскированное', async () => {
    const { svc } = setup();
    const [c1, c2] = await svc.listConversations('me');
    expect(c1).toMatchObject({
      role: 'buyer',
      unread: 2,
      counterpart: { id: 's1', username: 'seller' },
      order: { publicNumber: 'GM-1', title: 'Аккаунт CS2' },
      last: { text: 'пиши в тг ***', system: false },
    });
    expect(c1!.counterpart.avatarUrl).toMatch(/key=avatars%2Fs1\.png$/);
    // у вложения текста нет — пишем, что это вложение
    expect(c2).toMatchObject({ role: 'seller', unread: 0, order: null, last: { text: 'Вложение' } });
  });

  it('порядок — как у страницы из базы, описываются только её диалоги', async () => {
    const { svc, prisma, raw } = setup(['c2', 'c1']);
    const rows = await svc.listConversations('me', { limit: 51 });
    expect(rows.map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(prisma.conversation.findMany.mock.calls[0]![0]).toMatchObject({ where: { id: { in: ['c2', 'c1'] } } });
    // обе стороны — я продаю и я покупаю; свежие сверху по видимому времени
    expect(raw[0]!.text).toContain('c.seller_id = $');
    expect(raw[0]!.text).toContain('c.buyer_id = $');
    expect(raw[0]!.text).toContain('ORDER BY sort_at DESC, id DESC');
    expect(raw[0]!.values).toContain(51);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('«Показать ещё» — после последнего показанного: время и id', async () => {
    const { svc, raw } = setup();
    const before = new Date('2026-10-01T10:00:00.123Z');
    await svc.listConversations('me', { limit: 51, before, beforeId: '00000000-0000-4000-8000-000000000001' });
    expect(raw[0]!.text).toContain('(COALESCE(c.last_message_at, c.created_at), c.id) < ($');
    expect(raw[0]!.values).toEqual(expect.arrayContaining(['2026-10-01T10:00:00.123Z', '00000000-0000-4000-8000-000000000001']));
  });

  it('поиск — в базе: ник собеседника, номер и название заказа; «%» и «_» — обычные знаки', async () => {
    const { svc, prisma, raw } = setup(['c1']);
    const rows = await svc.listConversations('me', { limit: 51, q: ' 50%_off ' });
    expect(rows.map((c) => c.id)).toEqual(['c1']);
    const sql = raw[0]!;
    expect(sql.text).toContain('p.username ILIKE');
    expect(sql.text).toContain('o.public_number ILIKE');
    expect(sql.text).toContain("(o.listing_snapshot ->> 'title') ILIKE");
    expect(sql.values).toContain('%50\\%\\_off%');
    // план под каждый текст поиска — в своей транзакции
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('пустая страница — без лишних запросов', async () => {
    const { svc, prisma } = setup([]);
    expect(await svc.listConversations('me')).toEqual([]);
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
  });
});

describe('история диалога', () => {
  it('последние сообщения, по порядку; раньше брались первые сто', async () => {
    const { svc, prisma } = setup();
    const msgs = await svc.getMessages('c1', 'me', { limit: 2 });
    expect(prisma.message.findMany.mock.calls[0]![0]).toMatchObject({ orderBy: { createdAt: 'desc' }, take: 2 });
    expect(msgs.map((m) => m.id)).toEqual(['m2', 'm3']);
    expect(msgs[0]!.readAt).toBe(now);
  });

  it('прочитал — отправитель узнаёт сразу', async () => {
    const { svc } = setup();
    const read = vi.fn();
    svc.setReadPublisher(read);
    await svc.markRead('c1', 'me');
    expect(read).toHaveBeenCalledWith('c1', 'me', expect.any(Date));
  });
});
