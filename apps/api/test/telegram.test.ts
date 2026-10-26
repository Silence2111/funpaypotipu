import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramService } from '../src/modules/notifications/telegram.service';
import { TelegramController } from '../src/modules/notifications/telegram.controller';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

/**
 * Уведомления в Telegram. Проверяется: код привязки не подделать и не
 * продлить, чужой чат не перехватывает аккаунт, вебхук без секрета не
 * принимается, а уведомление уходит в Telegram только по настройкам.
 */

const ENV = { ...process.env };
const USER = '2f9c1d3e-8a4b-4c5d-9e6f-0a1b2c3d4e5f';

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_BOT_USERNAME = 'gamemarket_bot';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
  process.env.JWT_ACCESS_SECRET = 'access-secret';
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

function setup(holder: { id: string } | null = null) {
  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { telegramId?: string; id?: string } }) =>
        where.telegramId ? holder : { status: 'active' },
      ),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const sent: Array<{ chat_id: string; text: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: sent.length } }) };
    }),
  );
  return { tg: new TelegramService(prisma as never), prisma, sent };
}

describe('код привязки', () => {
  it('влезает в параметр start (до 64 символов) и возвращает того же пользователя', () => {
    const { tg } = setup();
    const code = tg.linkCode(USER);
    expect(code).toMatch(/^[A-Za-z0-9_-]{45}$/);
    expect(tg.parseLinkCode(code)).toBe(USER);
    expect(tg.linkUrl(USER)).toBe(`https://t.me/gamemarket_bot?start=${code}`);
  });

  it('подделка и просроченный код не принимаются', () => {
    const { tg } = setup();
    const code = tg.linkCode(USER);
    const forged = code.slice(0, 44) + (code[44] === 'A' ? 'B' : 'A');
    expect(tg.parseLinkCode(forged)).toBeNull();
    expect(tg.parseLinkCode(code, Date.now() + 16 * 60_000)).toBeNull();
  });
});

describe('бот', () => {
  it('/start с кодом привязывает чат и отвечает', async () => {
    const { tg, prisma, sent } = setup();
    await tg.handleUpdate({ message: { text: `/start ${tg.linkCode(USER)}`, chat: { id: 555, type: 'private' } } });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: USER }, data: { telegramId: '555' } });
    expect(sent[0]).toMatchObject({ chat_id: '555', text: expect.stringMatching(/^Готово/) });
  });

  it('чат, привязанный к другому аккаунту, чужой аккаунт не перехватывает', async () => {
    const { tg, prisma, sent } = setup({ id: 'someone-else' });
    await tg.handleUpdate({ message: { text: `/start ${tg.linkCode(USER)}`, chat: { id: 555 } } });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sent[0]?.text).toMatch(/другому аккаунту/);
  });

  it('вебхук без секрета не принимается', async () => {
    const { tg } = setup();
    const ctrl = new TelegramController(tg);
    await expect(ctrl.webhook('wrong', {})).rejects.toThrow();
    await expect(ctrl.webhook('hook-secret', {})).resolves.toEqual({ ok: true });
  });
});

describe('уведомление в Telegram', () => {
  function notifier(prefs: unknown) {
    const prisma = {
      notification: { create: vi.fn(async () => ({ id: 'n1' })) },
      user: { findUnique: vi.fn(async () => ({ email: null, telegramId: '555', notifyPrefs: prefs })) },
    };
    const telegram = { enabled: true, notify: vi.fn(async () => true) };
    const svc = new NotificationsService(prisma as never, { enabled: false } as never, telegram as never, { enabled: false } as never);
    return { svc, telegram };
  }

  it('сообщение покупателя — с превью, ссылкой на чат и кнопкой «Ответить»; ответ уйдёт в этот диалог', async () => {
    const { svc, telegram } = notifier(null);
    await svc.notify('u1', 'new_message', { conversationId: 'c1', preview: 'Когда передадите?' });
    expect(telegram.notify).toHaveBeenCalledWith(
      { id: 'u1', telegramId: '555' },
      {
        text: expect.stringMatching(/Новое сообщение\n«Когда передадите\?»\n.*\/chat\/c1$/),
        buttons: [[{ text: 'Ответить', data: 'rp:c1' }]],
        thread: 'c1',
      },
    );
  });

  it('товар выдан — кнопка «Подтвердить получение»', async () => {
    const { svc, telegram } = notifier(null);
    await svc.notify('u1', 'order_delivered', { orderId: 'o1' });
    expect(telegram.notify).toHaveBeenCalledWith(
      { id: 'u1', telegramId: '555' },
      { text: expect.stringMatching(/\/orders\/o1$/), buttons: [[{ text: 'Подтвердить получение', data: 'cf:o1' }]] },
    );
  });

  it('выключенная группа в Telegram не приходит', async () => {
    const { svc, telegram } = notifier({ telegram: { messages: false } });
    await svc.notify('u1', 'new_message', { conversationId: 'c1' });
    expect(telegram.notify).not.toHaveBeenCalled();
  });
});
