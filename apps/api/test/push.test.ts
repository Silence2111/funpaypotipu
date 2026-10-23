import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  generateVAPIDKeys: () => ({ publicKey: 'PUBLIC', privateKey: 'PRIVATE' }),
}));

import { PushService, pushEndpointOk } from '../src/modules/notifications/push.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

/**
 * Пуш-уведомления на телефон (Web Push). Проверяется: подписка только от
 * служб пушей браузеров, ключи сервера переживают перезапуск, отозванные
 * подписки удаляются, пуш уходит по тем же группам, что почта и Telegram,
 * и говорит, от кого сообщение и о каком лоте заказ.
 */

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH;
});

const encryption = {
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
};

function push(
  stored: Record<string, unknown> | null = null,
  subs: Array<Record<string, unknown>> = [],
) {
  const state = { setting: stored, subs: [...subs] };
  const prisma = {
    systemSetting: {
      findUnique: vi.fn(async () => (state.setting ? { value: state.setting } : null)),
      create: vi.fn(async ({ data }: { data: { value: Record<string, unknown> } }) => {
        state.setting = data.value;
        return data;
      }),
    },
    pushSubscription: {
      upsert: vi.fn(async () => ({})),
      count: vi.fn(async () => state.subs.length),
      findMany: vi.fn(async () => state.subs),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        state.subs = state.subs.filter((s) => s.id !== where.id);
      }),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return { svc: new PushService(prisma as never, encryption as never), prisma, state };
}

const SUB = {
  id: 's1',
  userId: 'u1',
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  p256dh: 'P',
  auth: 'A',
};

describe('подписка устройства', () => {
  it('только службы пушей браузеров по https', () => {
    expect(pushEndpointOk('https://fcm.googleapis.com/fcm/send/abc', true)).toBe(true);
    expect(pushEndpointOk('https://updates.push.services.mozilla.com/wpush/v2/x', true)).toBe(true);
    expect(pushEndpointOk('https://web.push.apple.com/QGx', true)).toBe(true);
    expect(pushEndpointOk('https://wns2-db5p.notify.windows.com/w/?token=x', true)).toBe(true);
    expect(pushEndpointOk('https://evil.example.com/push', true)).toBe(false);
    expect(pushEndpointOk('https://googleapis.com.evil.io/push', true)).toBe(false);
    expect(pushEndpointOk('http://fcm.googleapis.com/fcm/send/abc', true)).toBe(false);
    expect(pushEndpointOk('not a url', true)).toBe(false);
  });

  it('localhost — только вне прода, для проверок', () => {
    expect(pushEndpointOk('https://localhost:8443/push/a', false)).toBe(true);
    expect(pushEndpointOk('https://localhost:8443/push/a', true)).toBe(false);
  });

  it('чужой адрес не сохраняется', async () => {
    const { svc, prisma } = push();
    await svc.onModuleInit();
    await expect(
      svc.subscribe('u1', {
        endpoint: 'https://evil.example.com/x',
        keys: { p256dh: 'P', auth: 'A' },
      }),
    ).rejects.toThrow(/службы пушей/);
    expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
  });
});

describe('ключи сервера', () => {
  it('без окружения создаются один раз и хранятся в базе, закрытый — зашифрованным', async () => {
    const first = push();
    await first.svc.onModuleInit();
    expect(first.svc.publicKey).toBe('PUBLIC');
    expect(first.state.setting).toEqual({ publicKey: 'PUBLIC', privateKeyEnc: 'enc:PRIVATE' });
    // после перезапуска — те же ключи, а не новые: иначе отвалились бы все подписки
    const again = push(first.state.setting);
    await again.svc.onModuleInit();
    expect(again.svc.publicKey).toBe('PUBLIC');
    expect(again.prisma.systemSetting.create).not.toHaveBeenCalled();
  });

  it('WEB_PUSH=off выключает пуши', async () => {
    process.env.WEB_PUSH = 'off';
    const { svc } = push();
    await svc.onModuleInit();
    expect(svc.enabled).toBe(false);
  });
});

describe('отправка', () => {
  it('на все устройства пользователя, с подписью VAPID и сроком хранения', async () => {
    const { svc } = push(null, [
      SUB,
      { ...SUB, id: 's2', endpoint: 'https://fcm.googleapis.com/fcm/send/def' },
    ]);
    await svc.onModuleInit();
    await svc.send('u1', { title: 'Новое сообщение', body: 'Привет', url: '/chat/c1' }, true);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [target, payload, opts] = sendNotification.mock.calls[0]!;
    expect(target).toEqual({ endpoint: SUB.endpoint, keys: { p256dh: 'P', auth: 'A' } });
    expect(JSON.parse(payload as string)).toEqual({
      title: 'Новое сообщение',
      body: 'Привет',
      url: '/chat/c1',
    });
    expect(opts).toMatchObject({
      urgency: 'high',
      TTL: 86400,
      vapidDetails: { publicKey: 'PUBLIC', privateKey: 'PRIVATE' },
    });
  });

  it('служба ответила 410 — подписка удаляется, остальные получают', async () => {
    const { svc, state } = push(null, [SUB, { ...SUB, id: 's2' }]);
    await svc.onModuleInit();
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    await svc.send('u1', { title: 't', body: '', url: '/' });
    expect(state.subs.map((s) => s.id)).toEqual(['s2']);
  });

  it('служба лежит — подписка остаётся, а оплата и чат не падают', async () => {
    const { svc, state } = push(null, [SUB]);
    await svc.onModuleInit();
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 503 }));
    await expect(svc.send('u1', { title: 't', body: '', url: '/' })).resolves.toBeUndefined();
    expect(state.subs).toHaveLength(1);
  });
});

describe('пуш по группам уведомлений', () => {
  function notifier(prefs: unknown, devices = 1) {
    const prisma = {
      notification: { create: vi.fn(async () => ({ id: 'n1' })) },
      user: {
        findUnique: vi.fn(async () => ({ email: null, telegramId: null, notifyPrefs: prefs })),
      },
      order: {
        findUnique: vi.fn(async () => ({
          publicNumber: 'GM-1',
          listingSnapshot: { title: 'Аккаунт CS2 Prime' },
        })),
      },
    };
    const pusher = {
      enabled: true,
      devices: vi.fn(async () => devices),
      send: vi.fn(async () => undefined),
    };
    const svc = new NotificationsService(
      prisma as never,
      { enabled: false } as never,
      { enabled: false } as never,
      pusher as never,
    );
    return { svc, pusher };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('сообщение: от кого, превью, ссылка на чат; одно уведомление на чат', async () => {
    const { svc, pusher } = notifier(null);
    await svc.notify('u1', 'new_message', {
      conversationId: 'c1',
      preview: 'Ещё продаёте?',
      from: 'mirka_play',
    });
    await flush();
    expect(pusher.send).toHaveBeenCalledWith(
      'u1',
      { title: 'Сообщение от mirka_play', body: 'Ещё продаёте?', url: '/chat/c1', tag: '/chat/c1' },
      true,
    );
  });

  it('заказ: название лота в тексте — продавцу с десятком заказов иначе не понять', async () => {
    const { svc, pusher } = notifier(null);
    await svc.notify('u1', 'order_paid', { orderId: 'o1' });
    await flush();
    expect(pusher.send).toHaveBeenCalledWith(
      'u1',
      {
        title: 'Заказ оплачен — выдайте товар',
        body: 'Аккаунт CS2 Prime',
        url: '/orders/o1',
        tag: '/orders/o1',
      },
      true,
    );
  });

  it('выключенная группа и пользователь без устройств — пуша нет', async () => {
    const off = notifier({ push: { messages: false } });
    await off.svc.notify('u1', 'new_message', { conversationId: 'c1', preview: 'x' });
    const none = notifier(null, 0);
    await none.svc.notify('u1', 'new_message', { conversationId: 'c1', preview: 'x' });
    await flush();
    expect(off.pusher.send).not.toHaveBeenCalled();
    expect(none.pusher.send).not.toHaveBeenCalled();
  });

  it('кэшбэк — без срочности и без тега: не заменяет другие уведомления', async () => {
    const { svc, pusher } = notifier(null);
    await svc.notify('u1', 'cashback', {});
    await flush();
    expect(pusher.send).toHaveBeenCalledWith(
      'u1',
      { title: 'Кэшбэк за покупку зачислен на баланс', body: '', url: '/cabinet' },
      false,
    );
  });
});
