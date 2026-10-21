import { describe, expect, it, vi } from 'vitest';
import { ChatService } from '../src/modules/chat/chat.service';
import { ListingsService } from '../src/modules/listings/listings.service';
import {
  MAX_TEMPLATES,
  SellerToolsService,
} from '../src/modules/seller-tools/seller-tools.service';

/**
 * Инструменты продавца. Проверяется: приветствие уходит один раз на первое
 * сообщение покупателя до сделки, с пометкой «автоответ» и скрытыми
 * контактами, без уведомления; в диалоге заказа и после переписки — нет.
 * Автоподнятие поднимает лоты только у включивших его, не в отпуске и не
 * заблокированных, а сбой у одного продавца не останавливает остальных.
 * Заготовки: предел, чужую не изменить и не удалить.
 */

type Row = Record<string, unknown>;

function chat(opts: { greeting?: string | null; orderId?: string | null } = {}) {
  const messages: Row[] = [];
  const conv = { id: 'c1', buyerId: 'buyer', sellerId: 'seller', orderId: opts.orderId ?? null };
  const prisma = {
    conversation: {
      findUnique: vi.fn(async () => conv),
      update: vi.fn(async () => conv),
    },
    message: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `m${messages.length + 1}`, createdAt: new Date(), auto: false, ...data };
        messages.push(row);
        return row;
      }),
      count: vi.fn(
        async ({ where }: { where: { id: { not: string } } }) =>
          messages.filter((m) => m.senderId !== null && m.id !== where.id.not).length,
      ),
    },
    profile: {
      findUnique: vi.fn(async ({ select }: { select: Row }) =>
        'greetingText' in select
          ? { greetingText: opts.greeting === undefined ? 'Здравствуйте' : opts.greeting }
          : { username: 'nick' },
      ),
    },
    riskSignal: { create: vi.fn(async () => ({})) },
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const blocks = { assertCanContact: vi.fn(async () => undefined) };
  const svc = new ChatService(
    prisma as never,
    notifications as never,
    {} as never,
    {} as never,
    blocks as never,
  );
  const published: Row[] = [];
  svc.setPublisher((_c, m) => published.push(m as never));
  return { svc, messages, published, notifications };
}

describe('приветствие', () => {
  it('первое сообщение покупателя — автоответ продавца, один раз, без уведомления', async () => {
    const { svc, messages, published, notifications } = chat({
      greeting: 'Привет, пишите в телеграм @seller_tg',
    });
    await svc.sendMessage('c1', 'buyer', 'Есть в наличии?');
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ senderId: 'seller', auto: true });
    // Контакты в приветствии скрыты, как в любом сообщении продавца.
    expect(published[1]).toMatchObject({ auto: true });
    expect(String(published[1]!.body)).not.toContain('@seller_tg');
    // Уведомление — только продавцу о сообщении покупателя.
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith('seller', 'new_message', expect.anything());

    await svc.sendMessage('c1', 'buyer', 'Ау');
    expect(messages.filter((m) => m.auto)).toHaveLength(1);
  });

  it('в диалоге заказа, после ответа продавца и без текста — молчит', async () => {
    const order = chat({ orderId: 'o1' });
    await order.svc.sendMessage('c1', 'buyer', 'Где товар?');
    expect(order.messages.some((m) => m.auto)).toBe(false);

    const replied = chat();
    await replied.svc.sendMessage('c1', 'seller', 'Добрый день');
    await replied.svc.sendMessage('c1', 'buyer', 'Здравствуйте');
    expect(replied.messages.some((m) => m.auto)).toBe(false);

    const off = chat({ greeting: null });
    await off.svc.sendMessage('c1', 'buyer', 'Привет');
    expect(off.messages).toHaveLength(1);
  });
});

describe('автоподнятие', () => {
  it('только включившие, не в отпуске и не заблокированные; сбой одного не мешает другим', async () => {
    const findMany = vi.fn(async () => [{ userId: 's1' }, { userId: 's2' }, { userId: 's3' }]);
    const svc = new ListingsService(
      { profile: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const bumpAll = vi
      .spyOn(svc, 'bumpAll')
      .mockResolvedValueOnce({ bumped: 3, waiting: 0, nextInMinutes: null })
      .mockRejectedValueOnce(new Error('база недоступна'))
      .mockResolvedValueOnce({ bumped: 1, waiting: 2, nextInMinutes: 30 });
    expect(await svc.autoRaise()).toEqual({ sellers: 3, bumped: 4 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { autoRaise: true, awaySince: null, user: { status: 'active' } },
      }),
    );
    expect(bumpAll.mock.calls.map((c) => c[0])).toEqual(['s1', 's2', 's3']);
  });

  it('состояние: пауза по продажам и когда поднимется следующий лот', async () => {
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const svc = new ListingsService(
      {
        listing: {
          findMany: vi.fn(async () => [
            // Поднят 1 ч назад, пауза 4 ч — следующий через 3 ч.
            { boostUntil: new Date(now - 3600_000 + day) },
            { boostUntil: new Date(now - 2 * 3600_000 + day) },
          ]),
        },
        profile: { findUnique: vi.fn(async () => ({ salesCount: 3 })) },
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const s = await svc.raiseStatus('s1');
    expect(s).toMatchObject({ everyHours: 4, activeLots: 2 });
    expect(s.nextInMinutes).toBeGreaterThanOrEqual(119);
    expect(s.nextInMinutes).toBeLessThanOrEqual(121);
  });
});

describe('заготовки', () => {
  function tools(count = 0) {
    const prisma = {
      replyTemplate: {
        count: vi.fn(async () => count),
        create: vi.fn(async ({ data }: { data: Row }) => ({ id: 't1', ...data })),
        updateMany: vi.fn(async ({ where }: { where: Row }) => ({
          count: where.userId === 'u1' ? 1 : 0,
        })),
        deleteMany: vi.fn(async ({ where }: { where: Row }) => ({
          count: where.userId === 'u1' ? 1 : 0,
        })),
      },
      profile: { update: vi.fn(async () => ({})) },
    };
    return { svc: new SellerToolsService(prisma as never, {} as never), prisma };
  }

  it('не больше предела; чужую не изменить и не удалить', async () => {
    await expect(tools(MAX_TEMPLATES).svc.addTemplate('u1', 'a', 'b')).rejects.toThrow(/Не больше/);
    expect(
      await tools(2).svc.addTemplate('u1', 'Оплата', 'Спасибо за покупку, {имя}'),
    ).toMatchObject({
      title: 'Оплата',
    });
    const { svc } = tools();
    await expect(svc.updateTemplate('u2', 't1', 'x', 'y')).rejects.toThrow(/не найдена/);
    await expect(svc.removeTemplate('u2', 't1')).rejects.toThrow(/не найдена/);
    expect(await svc.removeTemplate('u1', 't1')).toEqual({ ok: true });
  });

  it('пустое приветствие — выключено', async () => {
    const { svc, prisma } = tools();
    expect(await svc.setGreeting('u1', '   ')).toEqual({ greeting: null });
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { greetingText: null },
    });
  });
});
