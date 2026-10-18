import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatService } from '../src/modules/chat/chat.service';

/**
 * Мессенджер: список диалогов и история.
 *
 * Список раньше отдавал голые строки диалогов — сайт писал «Диалог по
 * сделке» без имени собеседника и текста. История брала первые сто
 * сообщений, и в долгой переписке свежие не доходили до экрана.
 */

const now = new Date('2026-10-18T12:00:00Z');

function setup() {
  const prisma = {
    conversation: {
      findUnique: vi.fn(async () => ({ id: 'c1', buyerId: 'me', sellerId: 's1', orderId: null })),
      findMany: vi.fn(async (_args: unknown) => [
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
      ]),
    },
    message: {
      groupBy: vi.fn(async () => [{ conversationId: 'c1', _count: { _all: 2 } }]),
      findMany: vi.fn(async (_args: { where: unknown; orderBy: unknown; take: number }) => [
        { id: 'm3', conversationId: 'c1', senderId: 's1', body: 'c', bodyMasked: null, isFlagged: false, attachments: [], createdAt: now, readAt: null },
        { id: 'm2', conversationId: 'c1', senderId: 'me', body: 'b', bodyMasked: null, isFlagged: false, attachments: [], createdAt: now, readAt: now },
      ]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $queryRaw: vi.fn(async () => [
      { conversation_id: 'c1', sender_id: 's1', type: 'text', body: 'пиши в тг @me', body_masked: 'пиши в тг ***', created_at: now },
      { conversation_id: 'c2', sender_id: 'b2', type: 'attachment', body: '', body_masked: null, created_at: now },
    ]),
    profile: {
      findMany: vi.fn(async () => [
        { userId: 's1', username: 'seller', avatarUrl: 'avatars/s1.png', onlineAt: now },
        { userId: 'b2', username: 'buyer2', avatarUrl: null, onlineAt: null },
      ]),
    },
  };
  const svc = new ChatService(prisma as never, {} as never, { enabled: false } as never, {} as never, {} as never);
  return { svc, prisma };
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
