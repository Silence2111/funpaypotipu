import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReplySample } from '@gamemarket/shared';
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
 * Заготовки: предел, чужую не изменить и не удалить; команда хранится в
 * нижнем регистре и у продавца не повторяется. Автоответ на команду — только
 * на сообщение покупателя целиком, без дубля в течение минуты. Время ответа
 * считается от первого вопроса без ответа, автоответы ответом не считаются.
 */

type Row = Record<string, unknown>;

afterEach(() => {
  vi.useRealTimers();
});

function chat(
  opts: {
    greeting?: string | null;
    orderId?: string | null;
    templates?: Array<{ command: string; body: string }>;
  } = {},
) {
  const messages: Row[] = [];
  const state: { samples: unknown } = { samples: [] };
  const conv = { id: 'c1', buyerId: 'buyer', sellerId: 'seller', orderId: opts.orderId ?? null };
  const at = (m: Row) => (m.createdAt as Date).getTime();
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
      findFirst: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: { senderId: string; auto?: boolean; createdAt?: { lt?: Date; gt?: Date } };
          orderBy: { createdAt: 'asc' | 'desc' };
        }) => {
          const hit = messages.filter(
            (m) =>
              m.senderId === where.senderId &&
              (where.auto === undefined || m.auto === where.auto) &&
              (!where.createdAt?.lt || at(m) < where.createdAt.lt.getTime()) &&
              (!where.createdAt?.gt || at(m) > where.createdAt.gt.getTime()),
          );
          hit.sort((a, b) => (orderBy.createdAt === 'asc' ? at(a) - at(b) : at(b) - at(a)));
          return hit[0] ?? null;
        },
      ),
    },
    replyTemplate: {
      findFirst: vi.fn(
        async ({ where }: { where: { command: string } }) =>
          opts.templates?.find((t) => t.command === where.command) ?? null,
      ),
    },
    profile: {
      findUnique: vi.fn(async ({ select }: { select: Row }) =>
        'greetingText' in select
          ? { greetingText: opts.greeting === undefined ? 'Здравствуйте' : opts.greeting }
          : 'replySamples' in select
            ? { replySamples: state.samples }
            : { username: 'pro79161234567' },
      ),
      findMany: vi.fn(async () => [{ username: 'pro79161234567' }, { username: 'seller' }]),
      update: vi.fn(async ({ data }: { data: { replySamples: unknown } }) => {
        state.samples = data.replySamples;
        return {};
      }),
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
  return { svc, messages, published, notifications, prisma, state };
}

describe('автоответ на команду', () => {
  const templates = [{ command: '!оплата', body: '{имя}, оплата — СБП или картой' }];

  it('покупатель пишет команду — заготовка уходит от продавца с ником, и в заказе тоже', async () => {
    const { svc, messages, published, notifications } = chat({
      greeting: null,
      orderId: 'o1',
      templates,
    });
    await svc.sendMessage('c1', 'buyer', '  !ОПЛАТА ');
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      senderId: 'seller',
      auto: true,
      body: 'pro79161234567, оплата — СБП или картой',
    });
    // Ник похож на телефон, но это ник на площадке — не скрывается.
    expect(published[1]).toMatchObject({
      auto: true,
      body: 'pro79161234567, оплата — СБП или картой',
    });
    // Уведомление — только продавцу о сообщении покупателя.
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('первое сообщение — команда: сначала приветствие, потом ответ', async () => {
    const { svc, messages } = chat({ templates });
    await svc.sendMessage('c1', 'buyer', '!оплата');
    expect(messages.map((m) => [m.senderId, m.auto])).toEqual([
      ['buyer', false],
      ['seller', true],
      ['seller', true],
    ]);
    expect(messages[1]!.body).toBe('Здравствуйте');
  });

  it('ник собеседника в сообщении не скрывается и не считается сливом контактов', async () => {
    const { svc, published, prisma } = chat({ greeting: null });
    await svc.sendMessage('c1', 'seller', 'pro79161234567, спасибо за покупку');
    await svc.sendMessage('c1', 'seller', 'Звоните 89161234567');
    expect(published.map((m) => m.body)).toEqual([
      'pro79161234567, спасибо за покупку',
      'Звоните [скрыто]',
    ]);
    expect(prisma.riskSignal.create).toHaveBeenCalledTimes(1);
  });

  it('команда внутри фразы или от продавца — не ответ', async () => {
    const { svc, messages } = chat({ greeting: null, templates });
    await svc.sendMessage('c1', 'buyer', 'Подскажите, !оплата как?');
    await svc.sendMessage('c1', 'seller', '!оплата');
    expect(messages.some((m) => m.auto)).toBe(false);
  });

  it('повтор в течение минуты не дублирует ответ, через минуту — отвечает снова', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 21, 12));
    const { svc, messages } = chat({ greeting: null, templates });
    await svc.sendMessage('c1', 'buyer', '!оплата');
    vi.setSystemTime(Date.now() + 30_000);
    await svc.sendMessage('c1', 'buyer', '!оплата');
    expect(messages.filter((m) => m.auto)).toHaveLength(1);
    vi.setSystemTime(Date.now() + 61_000);
    await svc.sendMessage('c1', 'buyer', '!оплата');
    expect(messages.filter((m) => m.auto)).toHaveLength(2);
  });
});

describe('время ответа продавца', () => {
  it('от первого вопроса без ответа; автоответ — не ответ; без вопроса — не замер', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.UTC(2026, 9, 21, 12);
    const at = (sec: number) => vi.setSystemTime(t0 + sec * 1000);
    const { svc, state } = chat({
      greeting: null,
      templates: [{ command: '!цена', body: 'Цена в лоте' }],
    });
    at(0);
    await svc.sendMessage('c1', 'buyer', 'Есть в наличии?');
    at(60);
    await svc.sendMessage('c1', 'buyer', 'Ау');
    at(600);
    await svc.sendMessage('c1', 'seller', 'Да, есть');
    at(700);
    await svc.sendMessage('c1', 'seller', 'Пишите, если что');
    at(1000);
    await svc.sendMessage('c1', 'buyer', '!цена'); // автоответ сразу
    at(1300);
    await svc.sendMessage('c1', 'seller', 'Могу уступить');
    expect((state.samples as ReplySample[]).map(([, waited]) => waited)).toEqual([300, 600]);
  });

  it('сбой записи замера не роняет отправку', async () => {
    const { svc, prisma, messages } = chat({ greeting: null });
    prisma.profile.update.mockRejectedValueOnce(new Error('база недоступна'));
    await svc.sendMessage('c1', 'buyer', 'Есть?');
    await expect(svc.sendMessage('c1', 'seller', 'Есть')).resolves.toMatchObject({
      senderId: 'seller',
    });
    expect(messages).toHaveLength(2);
  });
});

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
    const existing = [{ id: 't1', userId: 'u1', command: '!оплата', title: 'Оплата' }];
    const prisma = {
      replyTemplate: {
        count: vi.fn(async () => count),
        findFirst: vi.fn(
          async ({ where }: { where: { userId: string; command: string; id?: { not: string } } }) =>
            existing.find(
              (t) =>
                t.userId === where.userId && t.command === where.command && t.id !== where.id?.not,
            ) ?? null,
        ),
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
    await expect(
      tools(MAX_TEMPLATES).svc.addTemplate('u1', { title: 'a', body: 'b' }),
    ).rejects.toThrow(/Не больше/);
    expect(
      await tools(2).svc.addTemplate('u1', { title: 'Оплата', body: 'Спасибо за покупку, {имя}' }),
    ).toMatchObject({
      title: 'Оплата',
      command: null,
    });
    const { svc } = tools();
    await expect(svc.updateTemplate('u2', 't1', { title: 'x', body: 'y' })).rejects.toThrow(
      /не найдена/,
    );
    await expect(svc.removeTemplate('u2', 't1')).rejects.toThrow(/не найдена/);
    expect(await svc.removeTemplate('u1', 't1')).toEqual({ ok: true });
  });

  it('команда — в нижнем регистре и одна на заготовку', async () => {
    const { svc, prisma } = tools();
    expect(
      await svc.addTemplate('u1', { title: 'Гарантия', body: 'Месяц', command: '  !Гарантия ' }),
    ).toMatchObject({ command: '!гарантия' });
    await expect(
      svc.addTemplate('u1', { title: 'Ещё', body: 'x', command: '!ОПЛАТА' }),
    ).rejects.toThrow('Команда !оплата уже есть у заготовки «Оплата»');
    // Своя же команда при изменении — не повтор; пустая — без команды.
    expect(
      await svc.updateTemplate('u1', 't1', { title: 'Оплата', body: 'СБП', command: '!оплата' }),
    ).toMatchObject({ command: '!оплата' });
    expect(
      await svc.updateTemplate('u1', 't1', { title: 'Оплата', body: 'СБП', command: ' ' }),
    ).toMatchObject({ command: null });
    expect(prisma.replyTemplate.findFirst).toHaveBeenCalledTimes(3);
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
