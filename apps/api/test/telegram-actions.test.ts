import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TelegramService } from '../src/modules/notifications/telegram.service';
import { TelegramActionsService } from '../src/modules/telegram-actions/telegram-actions.service';

/**
 * Кнопки и ответы в Telegram: нажимает и отвечает только тот, чей это
 * Telegram, в своём личном чате с ботом; подтверждение — с переспросом и
 * только по своему выданному заказу; ответ уходит в чат на сайте как обычное
 * сообщение участника.
 */

const ENV = { ...process.env };
const ORDER = '6b1f6f0e-3c1a-4d8e-9f0a-1b2c3d4e5f60';
const CONV = '7c2a7f1f-4d2b-4e9f-8a1b-2c3d4e5f6071';

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_BOT_USERNAME = 'gamemarket_bot';
  process.env.WEB_URL = 'https://gm.test';
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

type Row = Record<string, unknown>;

/** Бот с Telegram-чатами: 555 — u1, 777 — u2. */
function bot() {
  const holders: Record<string, Row> = {
    '555': { id: 'u1', locale: 'ru', status: 'active' },
    '777': { id: 'u2', locale: 'ru', status: 'active' },
  };
  const replies: Row[] = [];
  const prisma = {
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { telegramId: string } }) => holders[where.telegramId] ?? null,
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    telegramReply: {
      upsert: vi.fn(async ({ create }: { create: Row }) => {
        replies.push({ ...create, createdAt: new Date() });
        return create;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findUnique: vi.fn(
        async ({ where }: { where: { chatId_messageId: { chatId: string; messageId: number } } }) =>
          replies.find(
            (r) =>
              r.chatId === where.chatId_messageId.chatId &&
              r.messageId === where.chatId_messageId.messageId,
          ) ?? null,
      ),
    },
  };
  const calls: Array<{ method: string; body: Row }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ method: url.split('/').at(-1)!, body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 40 + calls.length } }),
      };
    }),
  );
  const actions = {
    press: vi.fn(async () => ({ text: 'нажато', replace: true })),
    reply: vi.fn(async () => ({ text: 'отправлено' })),
  };
  const tg = new TelegramService(prisma as never);
  tg.useActions(actions);
  const sent = (method: string) => calls.filter((c) => c.method === method).map((c) => c.body);
  return { tg, prisma, actions, calls, sent, replies };
}

describe('бот: ответы и нажатия', () => {
  it('ответ на уведомление о сообщении уходит в этот диалог; в чужом чате и без текста — нет', async () => {
    const { tg, actions, sent, replies } = bot();
    await tg.notify(
      { id: 'u1', telegramId: '555' },
      {
        text: 'Новое сообщение',
        buttons: [[{ text: 'Ответить', data: `rp:${CONV}` }]],
        thread: CONV,
      },
    );
    expect(sent('sendMessage')[0]).toMatchObject({
      chat_id: '555',
      reply_markup: { inline_keyboard: [[{ text: 'Ответить', callback_data: `rp:${CONV}` }]] },
    });
    const messageId = replies[0]!.messageId as number;
    expect(replies[0]).toMatchObject({ chatId: '555', userId: 'u1', conversationId: CONV });

    await tg.handleUpdate({
      message: {
        text: ' Передам вечером ',
        chat: { id: 555, type: 'private' },
        reply_to_message: { message_id: messageId },
      },
    });
    expect(actions.reply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      CONV,
      'Передам вечером',
      'ru',
    );
    expect(sent('sendMessage').at(-1)).toMatchObject({ chat_id: '555', text: 'отправлено' });

    // Тот же номер сообщения в другом чате — другое сообщение.
    await tg.handleUpdate({
      message: {
        text: 'чужой ответ',
        chat: { id: 777, type: 'private' },
        reply_to_message: { message_id: messageId },
      },
    });
    expect(actions.reply).toHaveBeenCalledTimes(1);
    expect(sent('sendMessage').at(-1)!.text).toMatch(/^Это бот уведомлений/);

    await tg.handleUpdate({
      message: { chat: { id: 555, type: 'private' }, reply_to_message: { message_id: messageId } },
    });
    expect(sent('sendMessage').at(-1)!.text).toMatch(/только текст/);
  });

  it('нажатие — только в личном чате владельца Telegram; часики снимаются всегда', async () => {
    const { tg, actions, sent } = bot();
    const press = (from: number, chat: number, data = `cf:${ORDER}`) =>
      tg.handleUpdate({
        callback_query: {
          id: `q${from}${chat}`,
          from: { id: from },
          message: { message_id: 9, chat: { id: chat } },
          data,
        },
      });
    await press(555, 555);
    expect(actions.press).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      `cf:${ORDER}`,
      'ru',
    );
    expect(sent('editMessageText')[0]).toMatchObject({
      chat_id: '555',
      message_id: 9,
      text: 'нажато',
    });

    // Кнопка в группе или чужом чате — не действие владельца.
    await press(555, -100);
    expect(actions.press).toHaveBeenCalledTimes(1);

    // Не подключённый Telegram — подсказка, без действия.
    await press(999, 999);
    expect(actions.press).toHaveBeenCalledTimes(1);
    expect(sent('sendMessage').at(-1)!.text).toMatch(/не подключён/);
    expect(sent('answerCallbackQuery')).toHaveLength(3);
  });
});

describe('действия из Telegram', () => {
  function actions(order: Row | null, conv: Row | null = { buyerId: 'buyer', sellerId: 'seller' }) {
    const prisma = {
      order: { findUnique: vi.fn(async () => order) },
      conversation: { findUnique: vi.fn(async () => conv) },
      profile: {
        findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => ({
          username: where.userId,
        })),
      },
    };
    const orders = { confirm: vi.fn(async () => ({})) };
    const chat = { sendMessage: vi.fn(async () => ({})) };
    const telegram = { useActions: vi.fn() };
    const svc = new TelegramActionsService(
      prisma as never,
      telegram as never,
      orders as never,
      chat as never,
    );
    svc.onModuleInit();
    return { svc, orders, chat, telegram };
  }
  const buyer = { id: 'buyer', locale: 'ru' };
  const delivered = { publicNumber: 'GM-A1', buyerId: 'buyer', status: 'delivered' };

  it('подтверждение — с переспросом; «Нет» и чужой заказ ничего не меняют; «Да» — заказ завершён', async () => {
    const { svc, orders, telegram } = actions(delivered);
    expect(telegram.useActions).toHaveBeenCalledWith(svc);
    const ask = await svc.press(buyer, `cf:${ORDER}`, 'ru');
    expect(ask.text).toMatch(
      /^Подтвердить получение по заказу GM-A1\?.*https:\/\/gm\.test\/orders\//s,
    );
    expect(ask.buttons).toEqual([
      [
        { text: 'Да, подтвердить', data: `cy:${ORDER}` },
        { text: 'Нет', data: `cn:${ORDER}` },
      ],
    ]);
    expect(ask.replace).toBeFalsy();
    expect(orders.confirm).not.toHaveBeenCalled();

    await expect(svc.press(buyer, `cn:${ORDER}`, 'ru')).resolves.toMatchObject({
      replace: true,
      text: expect.stringMatching(/не подтверждаем/),
    });
    await expect(
      svc.press({ id: 'seller', locale: 'ru' }, `cy:${ORDER}`, 'ru'),
    ).resolves.toMatchObject({ text: 'Это не ваш заказ' });
    expect(orders.confirm).not.toHaveBeenCalled();

    const done = await svc.press(buyer, `cy:${ORDER}`, 'ru');
    expect(orders.confirm).toHaveBeenCalledWith(ORDER, 'buyer');
    expect(done).toMatchObject({
      replace: true,
      text: expect.stringMatching(/^Получение подтверждено: заказ GM-A1 завершён/),
    });
  });

  it('заказ уже не ждёт подтверждения; отказ сервиса — его причиной на языке пользователя', async () => {
    const completed = actions({ ...delivered, status: 'completed' });
    await expect(completed.svc.press(buyer, `cy:${ORDER}`, 'ru')).resolves.toMatchObject({
      text: expect.stringMatching(/уже не ждёт/),
    });
    expect(completed.orders.confirm).not.toHaveBeenCalled();

    const racing = actions(delivered);
    racing.orders.confirm.mockRejectedValueOnce(new BadRequestException('Это не ваш заказ'));
    await expect(racing.svc.press(buyer, `cy:${ORDER}`, 'en')).resolves.toMatchObject({
      text: 'This isn’t your order',
    });
    await expect(racing.svc.press(buyer, 'zz:1', 'ru')).resolves.toMatchObject({
      text: expect.stringMatching(/устарела/),
    });
  });

  it('ответ — в чат от имени участника; не участнику — «Диалог не найден»; длинный — отказ', async () => {
    const { svc, chat } = actions(null);
    await expect(svc.press(buyer, `rp:${CONV}`, 'ru')).resolves.toEqual({
      text: 'Напишите ответ для @seller — он уйдёт в чат на сайте.',
      forceReply: true,
      thread: CONV,
    });
    await expect(svc.press({ id: 'stranger', locale: 'ru' }, `rp:${CONV}`, 'ru')).resolves.toEqual({
      text: 'Диалог не найден',
    });

    await expect(svc.reply(buyer, CONV, 'Спасибо', 'ru')).resolves.toEqual({
      text: 'Отправлено в чат с @seller.',
    });
    expect(chat.sendMessage).toHaveBeenCalledWith(CONV, 'buyer', 'Спасибо');
    await svc.reply(buyer, CONV, 'а'.repeat(4001), 'ru');
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);

    chat.sendMessage.mockRejectedValueOnce(
      new ForbiddenException('Пользователь ограничил переписку с вами'),
    );
    await expect(svc.reply(buyer, CONV, 'ещё', 'ru')).resolves.toEqual({
      text: 'Пользователь ограничил переписку с вами',
    });
  });
});
