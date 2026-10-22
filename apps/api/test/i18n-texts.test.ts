import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EN_TEXTS, say } from '../src/i18n/texts';
import {
  EMAIL_SUBJECTS,
  NotificationsService,
} from '../src/modules/notifications/notifications.service';
import { TelegramService } from '../src/modules/notifications/telegram.service';
import { AuthService } from '../src/modules/auth/auth.service';

/**
 * Письма, Telegram и пуши на языке получателя. Проверяется: у каждой
 * фразы, которую сервер пишет сам, есть перевод; уведомление уходит на
 * языке из профиля; бот без привязки отвечает на языке Telegram; вход
 * запоминает язык сайта, а письмо подтверждения приходит на нём.
 */

const SRC = join(__dirname, '../src');
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

describe('словарь серверных текстов', () => {
  it('у каждой фразы в say() есть перевод', () => {
    const keys = new Set<string>();
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bsay\(\s*[\w.()]+,\s*'((?:[^'\\]|\\.)*)'/g)) {
        keys.add(m[1]!.replace(/\\n/g, '\n').replace(/\\(.)/g, '$1'));
      }
    }
    expect(keys.size).toBeGreaterThan(10);
    for (const key of keys) expect(EN_TEXTS[key], key).toBeDefined();
  });

  it('темы писем переведены все', () => {
    for (const subject of Object.values(EMAIL_SUBJECTS))
      expect(EN_TEXTS[subject], subject).toBeDefined();
  });

  it('переводы без русских букв и с теми же подстановками', () => {
    for (const [ru, en] of Object.entries(EN_TEXTS)) {
      expect(en, ru).not.toMatch(/[а-яё]/i);
      expect(holes(en), ru).toEqual(holes(ru));
    }
  });

  it('по-русски — как написано, с подстановкой', () => {
    expect(say('ru', 'Сообщение от {name}', { name: 'anna' })).toBe('Сообщение от anna');
    expect(say('en', 'Сообщение от {name}', { name: 'anna' })).toBe('Message from anna');
  });
});

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe('уведомления на языке профиля', () => {
  function notifier(locale: string) {
    const prisma = {
      notification: { create: vi.fn(async () => ({ id: 'n1' })) },
      user: {
        findUnique: vi.fn(async () => ({
          email: 'a@b.c',
          telegramId: '555',
          notifyPrefs: null,
          locale,
        })),
      },
      order: {
        findUnique: vi.fn(async () => ({
          publicNumber: 'GM-1',
          listingSnapshot: { title: 'CS2 Prime' },
        })),
      },
    };
    const mail = { enabled: true, send: vi.fn(async () => undefined) };
    const telegram = { enabled: true, send: vi.fn(async () => true) };
    const push = {
      enabled: true,
      devices: vi.fn(async () => 1),
      send: vi.fn(async () => undefined),
    };
    const svc = new NotificationsService(
      prisma as never,
      mail as never,
      telegram as never,
      push as never,
    );
    return { svc, mail, telegram, push };
  }

  it('английский профиль — письмо, Telegram и пуш по-английски', async () => {
    const { svc, mail, telegram, push } = notifier('en');
    await svc.notify('u1', 'order_paid', { orderId: 'o1' });
    expect(mail.send).toHaveBeenCalledWith(
      'a@b.c',
      'New paid order',
      expect.stringMatching(/^New paid order\.\n\nDetails: http.*\/orders\/o1$/),
    );
    expect(telegram.send).toHaveBeenCalledWith(
      '555',
      expect.stringMatching(/^Order paid — deliver the goods\n/),
    );
    await vi.waitFor(() => expect(push.send).toHaveBeenCalled());
    expect(push.send).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ title: 'Order paid — deliver the goods', body: 'CS2 Prime' }),
      true,
    );
  });

  it('сообщение — «Message from …», превью в английских кавычках', async () => {
    const { svc, telegram, push } = notifier('en');
    await svc.notify('u1', 'new_message', { conversationId: 'c1', preview: 'hi', from: 'olga' });
    expect(telegram.send).toHaveBeenCalledWith(
      '555',
      expect.stringMatching(/^New message\n“hi”\n/),
    );
    await vi.waitFor(() => expect(push.send).toHaveBeenCalled());
    expect(push.send).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ title: 'Message from olga' }),
      true,
    );
  });

  it('русский профиль — как раньше', async () => {
    const { svc, mail, telegram } = notifier('ru');
    await svc.notify('u1', 'order_paid', { orderId: 'o1' });
    expect(mail.send).toHaveBeenCalledWith(
      'a@b.c',
      'Новый оплаченный заказ',
      expect.stringMatching(/^Новый оплаченный заказ\.\n\nПодробности: /),
    );
    expect(telegram.send).toHaveBeenCalledWith(
      '555',
      expect.stringMatching(/^Заказ оплачен — выдайте товар\n/),
    );
  });
});

describe('бот Telegram', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_BOT_USERNAME = 'gamemarket_bot';
    process.env.JWT_ACCESS_SECRET = 'access-secret';
  });

  function bot(holder: { id: string; locale: string } | null) {
    const prisma = {
      user: {
        findUnique: vi.fn(async ({ where }: { where: { telegramId?: string } }) =>
          where.telegramId ? holder : { status: 'active', locale: 'en' },
        ),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        sent.push((JSON.parse(init.body) as { text: string }).text);
        return { ok: true, status: 200 };
      }),
    );
    return { tg: new TelegramService(prisma as never), sent };
  }

  it('без привязки — на языке Telegram', async () => {
    const { tg, sent } = bot(null);
    await tg.handleUpdate({
      message: { text: 'hi', chat: { id: 1, type: 'private' }, from: { language_code: 'en' } },
    });
    await tg.handleUpdate({
      message: { text: 'привет', chat: { id: 2, type: 'private' }, from: { language_code: 'ru' } },
    });
    expect(sent[0]).toMatch(/^This is the GameMarket notifications bot/);
    expect(sent[1]).toMatch(/^Это бот уведомлений GameMarket/);
  });

  it('привязанному — на языке профиля, привязка — на языке аккаунта', async () => {
    const { tg, sent } = bot({ id: 'u1', locale: 'ru' });
    await tg.handleUpdate({
      message: { text: '/stop', chat: { id: 3, type: 'private' }, from: { language_code: 'en' } },
    });
    expect(sent[0]).toMatch(/^Уведомления отключены/);

    const fresh = bot(null);
    const code = fresh.tg.linkCode('2f9c1d3e-8a4b-4c5d-9e6f-0a1b2c3d4e5f');
    await fresh.tg.handleUpdate({
      message: { text: `/start ${code}`, chat: { id: 4, type: 'private' } },
    });
    expect(fresh.sent[0]).toMatch(/^Done: GameMarket notifications will arrive here/);
  });
});

describe('вход запоминает язык сайта', () => {
  function auth() {
    const prisma = {
      user: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { email: string } }) => ({
          id: 'u1',
          email: data.email,
          profile: { username: 'olga' },
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      authSession: { create: vi.fn(async () => ({})), count: vi.fn(async () => 0) },
      userRole: { findMany: vi.fn(async () => []) },
    };
    const tokens = {
      signPurpose: vi.fn(() => 'tok'),
      signAccess: vi.fn(() => 'access'),
      signRefresh: vi.fn(() => 'refresh'),
    };
    const mail = { enabled: true, send: vi.fn(async () => undefined) };
    const svc = new AuthService(prisma as never, tokens as never, {} as never, mail as never);
    return { svc, prisma, mail };
  }

  it('регистрация с английского сайта — locale en и письмо по-английски', async () => {
    const { svc, prisma, mail } = auth();
    await svc.register({ email: 'o@e.test', password: 'password123', username: 'olga' } as never, {
      lang: 'en',
    });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ locale: 'en' }) }),
    );
    expect(mail.send).toHaveBeenCalledWith(
      'o@e.test',
      'Confirm your email — GameMarket',
      expect.stringMatching(/^Hello, olga\. Confirm your email: /),
    );
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', locale: { not: 'en' } },
      data: { locale: 'en' },
    });
  });

  it('без языка — русское письмо, язык профиля не трогается', async () => {
    const { svc, prisma, mail } = auth();
    await svc.register(
      { email: 'o@e.test', password: 'password123', username: 'olga' } as never,
      {},
    );
    expect(mail.send).toHaveBeenCalledWith(
      'o@e.test',
      'Подтвердите e-mail — GameMarket',
      expect.stringMatching(/^Здравствуйте, olga\./),
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
