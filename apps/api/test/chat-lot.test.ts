import { describe, expect, it, vi } from 'vitest';
import { ChatService } from '../src/modules/chat/chat.service';

/**
 * Вопрос со страницы лота. У продавца десятки лотов, и «ещё продаёте?» без
 * контекста ему ни о чём не говорит: перед вопросом в диалог встаёт строка
 * «Вопрос о лоте …». Следующий вопрос о том же лоте её не повторяет.
 */

function setup({ lastSystem = null as string | null, existing = true } = {}) {
  const conv = (id: string) => ({ id, buyerId: 'b1', sellerId: 's1', orderId: null });
  const prisma = {
    listing: { findUnique: vi.fn(async () => ({ sellerId: 's1', title: 'Аккаунт CS2 Prime' })) },
    conversation: {
      findFirst: vi.fn(async () => (existing ? conv('c1') : null)),
      create: vi.fn(async () => conv('c2')),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => conv(where.id)),
      update: vi.fn(async () => ({})),
    },
    message: {
      findFirst: vi.fn(async () => (lastSystem ? { body: lastSystem } : null)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `m${prisma.message.create.mock.calls.length}`,
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
  return { svc, prisma, notifications };
}

describe('вопрос продавцу со страницы лота', () => {
  it('первый вопрос: диалог создаётся, перед вопросом — строка о лоте', async () => {
    const { svc, prisma, notifications } = setup({ existing: false });
    const res = await svc.startWithSeller('b1', 'l1', 'Ещё продаёте?');
    expect(prisma.conversation.create).toHaveBeenCalled();
    expect(res.id).toBe('c2');
    expect(res.messages?.map((m) => [m.senderId, m.body])).toEqual([
      [null, 'Вопрос о лоте «Аккаунт CS2 Prime»'],
      ['b1', 'Ещё продаёте?'],
    ]);
    // Продавцу приходит уведомление о вопросе, а не о строке контекста.
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('снова о том же лоте — строка не повторяется', async () => {
    const { svc, prisma } = setup({ lastSystem: 'Вопрос о лоте «Аккаунт CS2 Prime»' });
    const res = await svc.startWithSeller('b1', 'l1', 'А скидка будет?');
    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(res.messages?.map((m) => m.body)).toEqual(['А скидка будет?']);
  });

  it('о другом лоте того же продавца — новая строка контекста', async () => {
    const { svc } = setup({ lastSystem: 'Вопрос о лоте «Золото WoW, 10 000»' });
    const res = await svc.startWithSeller('b1', 'l1', 'А этот?');
    expect(res.messages?.map((m) => m.senderId)).toEqual([null, 'b1']);
  });

  it('без текста — только открыть диалог, ничего не пишется', async () => {
    const { svc, prisma } = setup();
    const res = await svc.startWithSeller('b1', 'l1');
    expect(res).toEqual({ id: 'c1' });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('свой лот — отказ', async () => {
    const { svc } = setup();
    await expect(svc.startWithSeller('s1', 'l1', 'привет')).rejects.toThrow('Это ваш лот');
  });
});
