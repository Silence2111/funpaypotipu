import { describe, expect, it, vi } from 'vitest';
import { ChatService } from '../src/modules/chat/chat.service';

/**
 * Новое сообщение должно приходить в открытый чат сразу. Раньше в комнату
 * сокета уходили только сообщения, отправленные через сокет: системные
 * («Оплата поступила», «Продавец вернул деньги») и отправленные через REST
 * собеседник видел только после перезагрузки.
 */

function setup() {
  const prisma = {
    conversation: {
      findUnique: vi.fn(async () => ({ id: 'c1', buyerId: 'b1', sellerId: 's1' })),
      update: vi.fn(async () => ({})),
    },
    message: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'm1',
        createdAt: new Date(),
        ...data,
      })),
    },
    riskSignal: { create: vi.fn(async () => ({})) },
    profile: { findUnique: vi.fn(async () => ({ username: 'buyer' })) },
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const blocks = { assertCanContact: vi.fn(async () => undefined) };
  const svc = new ChatService(prisma as never, notifications as never, {} as never, {} as never, blocks as never);
  const publish = vi.fn();
  svc.setPublisher(publish);
  return { svc, publish };
}

describe('доставка сообщений в открытый чат', () => {
  it('системное сообщение сделки уходит в комнату диалога', async () => {
    const { svc, publish } = setup();
    await svc.postSystem('o1', 'Оплата поступила — средства защищены эскроу.');
    expect(publish).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ senderId: null, body: 'Оплата поступила — средства защищены эскроу.' }),
      // и в списки диалогов обоих участников
      ['b1', 's1'],
    );
  });

  it('сообщение через REST тоже уходит в комнату — и уже без контактов', async () => {
    const { svc, publish } = setup();
    await svc.sendMessage('c1', 'b1', 'пиши в телеграм @buyer_tg');
    const [, msg] = publish.mock.calls[0]!;
    expect(msg.senderId).toBe('b1');
    expect(msg.body).not.toMatch(/buyer_tg|телеграм/);
    expect(msg.isFlagged).toBe(true);
  });
});
