import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayoutsService } from '../src/modules/payouts/payouts.service';
import {
  CARD_WIDGET_URL,
  YooKassaPayouts,
  type GatewayPayout,
} from '../src/modules/payouts/yookassa-payouts';

/**
 * Выплаты через ЮKassa. Проверяется: реквизиты СБП и ЮMoney проверяются
 * при заявке; карта — только токеном из виджета ЮKassa, номер не
 * хранится; одобрение отправляет сумму «на руки» один раз; «выплачено» —
 * только после подтверждения шлюза со сверкой суммы; отмена возвращает
 * деньги на баланс; USDT — вручную, реквизиты сотруднику — с записью в
 * журнал; потерянное уведомление подбирает сверка.
 */

const ENV = { ...process.env };
beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.PAYOUT_PROVIDER = 'yookassa';
  process.env.YOOKASSA_PAYOUT_AGENT_ID = '505050';
  process.env.YOOKASSA_PAYOUT_SECRET_KEY = 'payout_secret';
  delete process.env.YOOKASSA_API_URL;
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

type Call = {
  url: string;
  init: { method?: string; headers: Record<string, string>; body?: string };
};
function stubFetch(reply: (c: Call) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: Call['init']) => {
      calls.push({ url, init });
      const r = reply({ url, init });
      return { status: r.status, json: async () => r.json };
    }),
  );
  return calls;
}

describe('шлюз выплат', () => {
  it('СБП, ЮMoney и карта — сам, USDT — вручную; карты выключаются; без ключей — всё вручную', () => {
    const g = new YooKassaPayouts();
    expect(['sbp', 'yoomoney', 'card', 'usdt'].map((m) => g.handles(m))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    process.env.YOOKASSA_PAYOUT_CARDS = 'off';
    expect([g.handles('card'), g.cardWidget()]).toEqual([false, null]);
    delete process.env.YOOKASSA_PAYOUT_CARDS;
    delete process.env.YOOKASSA_PAYOUT_SECRET_KEY;
    expect(g.handles('sbp')).toBe(false);
  });

  it('виджет карты: id шлюза и скрипт ЮKassa; тестовый скрипт — только вне прода', () => {
    const g = new YooKassaPayouts();
    process.env.YOOKASSA_PAYOUT_WIDGET_URL = 'http://localhost:4998/payouts-data/widget.js';
    expect(g.cardWidget()).toEqual({
      accountId: '505050',
      scriptUrl: 'http://localhost:4998/payouts-data/widget.js',
    });
    process.env.NODE_ENV = 'production';
    expect(g.cardWidget()?.scriptUrl).toBe(CARD_WIDGET_URL);
    expect(CARD_WIDGET_URL).toMatch(/^https:\/\/yookassa\.ru\/payouts-data\//);
  });

  it('выплата на карту — токеном из виджета, без реквизитов карты', async () => {
    const calls = stubFetch(() => ({
      status: 200,
      json: {
        id: 'po-2',
        status: 'pending',
        amount: { value: '975.00', currency: 'RUB' },
        metadata: { payoutId: 'p2' },
      },
    }));
    await new YooKassaPayouts().create({
      payoutId: 'p2',
      amount: 97_500n,
      currency: 'RUB',
      destination: { method: 'card', token: 'pt-0123456789abcdef' },
    });
    const body = JSON.parse(calls[0]!.init.body!);
    expect(body.payout_token).toBe('pt-0123456789abcdef');
    expect(body).not.toHaveProperty('payout_destination_data');
  });

  it('выплата: сумма в рублях, получатель, ключ идемпотентности — id заявки, ключи агента', async () => {
    const calls = stubFetch(() => ({
      status: 200,
      json: {
        id: 'po-1',
        status: 'pending',
        amount: { value: '975.00', currency: 'RUB' },
        metadata: { payoutId: 'p1' },
      },
    }));
    const g = await new YooKassaPayouts().create({
      payoutId: 'p1',
      amount: 97_500n,
      currency: 'RUB',
      destination: { method: 'sbp', phone: '79001234567', bankId: '100000000111' },
    });
    expect(g).toMatchObject({ id: 'po-1', status: 'pending', amount: 97_500n, payoutId: 'p1' });
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.yookassa.ru/v3/payouts');
    expect(init.headers['Idempotence-Key']).toBe('p1');
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('505050:payout_secret').toString('base64')}`,
    );
    expect(JSON.parse(init.body!)).toMatchObject({
      amount: { value: '975.00', currency: 'RUB' },
      payout_destination_data: { type: 'sbp', phone: '79001234567', bank_id: '100000000111' },
      metadata: { payoutId: 'p1' },
    });
  });

  it('банки СБП — один запрос в час', async () => {
    const calls = stubFetch(() => ({
      status: 200,
      json: { type: 'list', items: [{ bank_id: '100000000111', name: 'Сбербанк', bic: '1' }] },
    }));
    const g = new YooKassaPayouts();
    expect(await g.sbpBanks()).toEqual([{ id: '100000000111', name: 'Сбербанк' }]);
    await g.sbpBanks();
    expect(calls).toHaveLength(1);
  });
});

/** Заявки в памяти: updateMany с условием по статусу — как в базе. */
function setup(over: Record<string, unknown> = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const saved: Record<string, unknown>[] = [];
  const add = (p: Record<string, unknown>) => rows.set(p.id as string, p);
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in (v as object))
        return (v as { in: unknown[] }).in.includes(row[k]);
      if (v && typeof v === 'object' && 'not' in (v as object))
        return row[k] !== (v as { not: unknown }).not;
      if (v && typeof v === 'object' && 'lt' in (v as object))
        return (row[k] as Date) < (v as { lt: Date }).lt;
      return row[k] === v;
    });
  const prisma = {
    payout: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `p${rows.size + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          externalId: null,
          failureReason: null,
          ...data,
        };
        add(row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          [...rows.values()].find((r) => matches(r, where)) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        [...rows.values()].filter((r) => matches(r, where)),
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
          Object.assign(rows.get(where.id)!, data),
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const hit = [...rows.values()].filter((r) => matches(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        },
      ),
    },
    profile: { findUnique: vi.fn(async () => ({ salesCount: 3 })) },
    kycVerification: { findFirst: vi.fn(async () => ({ id: 'k' })) },
    payoutDestination: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          saved.find((r) => matches(r, where)) ?? null,
      ),
      findMany: vi.fn(
        async ({ where, skip = 0 }: { where: Record<string, unknown>; skip?: number }) =>
          saved
            .filter((r) => matches(r, where))
            .sort((a, b) => (b.lastUsedAt as Date).getTime() - (a.lastUsedAt as Date).getTime())
            .slice(skip),
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId_fingerprint: { userId: string; fingerprint: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const hit = saved.find((r) => matches(r, where.userId_fingerprint));
          if (hit) return Object.assign(hit, update);
          const row = { id: `d${saved.length + 1}`, lastUsedAt: new Date(), ...create };
          saved.push(row);
          return row;
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const gone = saved.filter((r) => matches(r, where));
        gone.forEach((r) => saved.splice(saved.indexOf(r), 1));
        return { count: gone.length };
      }),
    },
  };
  const posted = new Set<string>();
  const ledger = {
    balanceOf: vi.fn(async () => 10_000_000n),
    post: vi.fn(
      async ({ idempotencyKey }: { idempotencyKey: string }) => void posted.add(idempotencyKey),
    ),
  };
  const encryption = {
    encrypt: (s: string) => `enc:${s}`,
    decrypt: (s: string) => s.replace(/^enc:/, ''),
    fingerprint: (s: string) => `fp:${s}`,
  };
  const audit = { log: vi.fn(async (_e: { action: string }) => undefined) };
  const notifications = { notify: vi.fn(async () => undefined) };
  const gateway = {
    enabled: true,
    handles: (m: string) => m === 'sbp' || m === 'yoomoney' || m === 'card',
    sbpBanks: vi.fn(async () => [{ id: '100000000111', name: 'Сбербанк' }]),
    create: vi.fn(async (i: { payoutId: string; amount: bigint }): Promise<GatewayPayout> => ({
      id: `po-${i.payoutId}`,
      status: 'pending',
      amount: i.amount,
      currency: 'RUB',
      payoutId: i.payoutId,
      reason: null,
    })),
    fetch: vi.fn(async (_id: string): Promise<GatewayPayout | null> => null),
    ...over,
  };
  const svc = new PayoutsService(
    prisma as never,
    ledger as never,
    encryption as never,
    audit as never,
    notifications as never,
    gateway as never,
  );
  return { svc, rows, saved, ledger, posted, notifications, gateway, audit };
}

const AMOUNT = 100_000n; // 1000 ₽, СБП 2,5% → комиссия 25 ₽, на руки 975 ₽
const USDT = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE8x7Fd';
const CARD = {
  token: 'pt-0123456789abcdef',
  first6: '555555',
  last4: '4477',
  type: 'MasterCard',
  issuer: 'Т-Банк',
};

describe('заявка и одобрение', () => {
  it('СБП: телефон приводится к 7XXXXXXXXXX, банк обязателен и из списка', async () => {
    const { svc, rows } = setup();
    await expect(svc.request('u1', AMOUNT, 'sbp', '+7 900 123-45-67')).rejects.toThrow(
      /Выберите банк/,
    );
    await expect(
      svc.request('u1', AMOUNT, 'sbp', '+7 900 123-45-67', 'RUB', { bankId: 'nope' }),
    ).rejects.toThrow(/Выберите банк/);
    await expect(
      svc.request('u1', AMOUNT, 'sbp', '123', 'RUB', { bankId: '100000000111' }),
    ).rejects.toThrow(/Телефон для СБП/);
    await svc.request('u1', AMOUNT, 'sbp', '8 (900) 123-45-67', 'RUB', { bankId: '100000000111' });
    expect(rows.get('p1')!.destinationEnc).toBe(
      'enc:{"phone":"79001234567","bankId":"100000000111"}',
    );
  });

  it('одобрение отправляет сумму «на руки» и ждёт подтверждения; второе одобрение — отказ', async () => {
    const { svc, rows, gateway, posted } = setup();
    await svc.request('u1', AMOUNT, 'sbp', '+79001234567', 'RUB', { bankId: '100000000111' });
    const out = await svc.approve('p1', 'fin');
    expect(gateway.create).toHaveBeenCalledWith(
      expect.objectContaining({ payoutId: 'p1', amount: 97_500n }),
    );
    expect(out).toMatchObject({ status: 'processing', externalId: 'po-p1' });
    expect(posted.has('payout_settle:p1')).toBe(false);
    await expect(svc.approve('p1', 'fin')).rejects.toThrow(/уже обработана/);
    expect(rows.get('p1')!.status).toBe('processing');
  });

  it('шлюз не ответил — заявка снова ждёт одобрения', async () => {
    const { svc, rows, gateway } = setup();
    gateway.create.mockRejectedValueOnce(new Error('шлюз недоступен'));
    await svc.request('u1', AMOUNT, 'yoomoney', '4100 1234 5678 901');
    await expect(svc.approve('p1', 'fin')).rejects.toThrow('шлюз недоступен');
    expect(rows.get('p1')!.status).toBe('requested');
  });

  it('USDT — вручную: реквизиты сотруднику с записью в журнал, одобрение сразу «выплачено»', async () => {
    const { svc, gateway, posted, audit } = setup();
    const req = await svc.request('u1', AMOUNT, 'usdt', USDT);
    expect(req.destinationHint).toBe('TQn9…x7Fd');
    expect(await svc.reveal('p1', 'fin')).toMatchObject({ destination: USDT });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'payout.reveal' }));
    expect(await svc.approve('p1', 'fin')).toMatchObject({ status: 'paid' });
    expect(gateway.create).not.toHaveBeenCalled();
    expect(posted.has('payout_settle:p1')).toBe(true);
  });

  it('карта: без токена ЮKassa — отказ; в заявке токен и маска, номера нет', async () => {
    const { svc, rows, gateway } = setup();
    await expect(svc.request('u1', AMOUNT, 'card', '4111111111111111')).rejects.toThrow(
      /форме ЮKassa/,
    );
    const req = await svc.request('u1', AMOUNT, 'card', undefined, 'RUB', { card: CARD });
    expect(req.destinationHint).toBe('•••• 4477');
    expect(rows.get('p1')!.destinationEnc).not.toMatch(/4111|555555\d{6}/);
    await expect(svc.reveal('p1', 'fin')).rejects.toThrow(/отправляет ЮKassa/);
    await svc.approve('p1', 'fin');
    expect(gateway.create).toHaveBeenCalledWith(
      expect.objectContaining({ destination: { method: 'card', token: CARD.token } }),
    );
  });

  it('карта из виджета, а выплаты ЮKassa выключили — вручную «выплатить» нельзя', async () => {
    const on = setup();
    await on.svc.request('u1', AMOUNT, 'card', undefined, 'RUB', { card: CARD });
    // Та же заявка, но шлюз карты больше не выплачивает.
    const off = setup({ handles: () => false });
    off.rows.set('p1', on.rows.get('p1')!);
    await expect(off.svc.approve('p1', 'fin')).rejects.toThrow(/только она/);
    await expect(off.svc.reveal('p1', 'fin')).rejects.toThrow(/отправляет ЮKassa/);
    expect(off.posted.has('payout_settle:p1')).toBe(false);
  });
});

describe('сохранённые реквизиты', () => {
  it('«запомнить» — сохраняются один раз, наружу только маска и банк; следующий вывод — по ним', async () => {
    const { svc, rows, saved } = setup();
    await svc.request('u1', AMOUNT, 'sbp', '+7 900 123-45-67', 'RUB', {
      bankId: '100000000111',
      save: true,
    });
    await svc.request('u1', AMOUNT, 'sbp', '8 (900) 123-45-67', 'RUB', {
      bankId: '100000000111',
      save: true,
    });
    expect(saved).toHaveLength(1);
    const list = await svc.destinations('u1');
    expect(list).toEqual([
      {
        id: 'd1',
        method: 'sbp',
        hint: '•••• 4567',
        bank: 'Сбербанк',
        lastUsedAt: expect.any(Date),
      },
    ]);
    expect(JSON.stringify(list)).not.toContain('79001234567');

    const third = await svc.request('u1', AMOUNT, 'sbp', undefined, 'RUB', { savedId: 'd1' });
    expect(rows.get(third.id)!.destinationEnc).toBe(
      'enc:{"phone":"79001234567","bankId":"100000000111"}',
    );
    // Чужие и другого способа — не подходят.
    await expect(
      svc.request('u2', AMOUNT, 'sbp', undefined, 'RUB', { savedId: 'd1' }),
    ).rejects.toThrow('Сохранённые реквизиты не найдены');
    await expect(
      svc.request('u1', AMOUNT, 'yoomoney', undefined, 'RUB', { savedId: 'd1' }),
    ).rejects.toThrow('Сохранённые реквизиты не найдены');
  });

  it('карта из виджета — одна запись на карту, токен новый; вручную её не выплатить', async () => {
    const { svc, saved, gateway } = setup();
    await svc.request('u1', AMOUNT, 'card', undefined, 'RUB', { card: CARD, save: true });
    await svc.request('u1', AMOUNT, 'card', undefined, 'RUB', {
      card: { ...CARD, token: 'pt-fedcba9876543210' },
      save: true,
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.destinationEnc).toContain('pt-fedcba9876543210');
    expect((await svc.destinations('u1'))[0]).toMatchObject({ hint: '•••• 4477', bank: null });

    gateway.handles = (m: string) => m === 'sbp' || m === 'yoomoney';
    await expect(
      svc.request('u1', AMOUNT, 'card', undefined, 'RUB', { savedId: 'd1' }),
    ).rejects.toThrow('сейчас не подходят');
  });

  it('удалить можно только свои; хранится не больше 10', async () => {
    const { svc, saved } = setup();
    for (let i = 0; i < 11; i++) {
      await svc.request(
        'u1',
        50_000n,
        'usdt',
        `${USDT.slice(0, -2)}${String(i).padStart(2, '0')}`,
        'RUB',
        {
          save: true,
        },
      );
    }
    expect(saved).toHaveLength(10);
    await expect(svc.forgetDestination('u2', saved[0]!.id as string)).rejects.toThrow('не найдены');
    await svc.forgetDestination('u1', saved[0]!.id as string);
    expect(saved).toHaveLength(9);
  });
});

describe('отказ сотрудника', () => {
  it('без причины — отказ; с причиной — деньги на баланс, причина в заявке и уведомлении', async () => {
    const { svc, rows, posted, notifications, audit } = setup();
    await svc.request('u1', AMOUNT, 'usdt', USDT);
    await expect(svc.reject('p1', 'fin', '  ')).rejects.toThrow('Напишите причину отказа');
    expect(rows.get('p1')!.status).toBe('requested');

    const reason = 'Кошелёк USDT не на ваше имя — укажите свой';
    expect(await svc.reject('p1', 'fin', `  ${reason} `)).toMatchObject({
      status: 'rejected',
      rejectReason: reason,
    });
    expect(posted.has('payout_reverse:p1')).toBe(true);
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'payout_rejected', {
      payoutId: 'p1',
      amount: AMOUNT.toString(),
      reason,
      preview: reason,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payout.reject', after: { reason } }),
    );
    expect((await svc.listMine('u1'))[0]).toMatchObject({ rejectReason: reason });
    await expect(svc.reject('p1', 'fin', reason)).rejects.toThrow(/уже обработана/);
  });
});

describe('итог от шлюза', () => {
  const note = (event: string) => ({ type: 'notification', event, object: { id: 'po-p1' } });
  const result = (status: GatewayPayout['status'], amount = 97_500n): GatewayPayout => ({
    id: 'po-p1',
    status,
    amount,
    currency: 'RUB',
    payoutId: 'p1',
    reason: status === 'canceled' ? 'insufficient_funds' : null,
  });

  async function sent(over: Record<string, unknown> = {}) {
    const ctx = setup(over);
    await ctx.svc.request('u1', AMOUNT, 'sbp', '+79001234567', 'RUB', { bankId: '100000000111' });
    await ctx.svc.approve('p1', 'fin');
    return ctx;
  }

  it('выплачено — резерв уходит, уведомление одно, повтор без последствий', async () => {
    const { svc, rows, gateway, posted, notifications } = await sent();
    gateway.fetch.mockResolvedValue(result('succeeded'));
    expect(await svc.webhook(note('payout.succeeded'))).toMatchObject({ status: 'paid' });
    expect(rows.get('p1')!.status).toBe('paid');
    expect(posted.has('payout_settle:p1')).toBe(true);
    await svc.webhook(note('payout.succeeded'));
    expect(notifications.notify.mock.calls.filter((c) => c[1] === 'payout_paid')).toHaveLength(1);
  });

  it('отменена — деньги на баланс, причина в заявке', async () => {
    const { svc, rows, gateway, posted } = await sent();
    gateway.fetch.mockResolvedValue(result('canceled'));
    await svc.webhook(note('payout.canceled'));
    expect(rows.get('p1')).toMatchObject({
      status: 'rejected',
      failureReason: 'insufficient_funds',
    });
    expect(posted.has('payout_reverse:p1')).toBe(true);
  });

  it('шлюз сообщил другую сумму — ничего не проводится', async () => {
    const { svc, rows, gateway, posted } = await sent();
    gateway.fetch.mockResolvedValue(result('succeeded', 100n));
    await expect(svc.webhook(note('payout.succeeded'))).rejects.toThrow(/не совпадает/);
    expect(rows.get('p1')!.status).toBe('processing');
    expect(posted.has('payout_settle:p1')).toBe(false);
  });

  it('поддельное уведомление о неизвестной выплате отклоняется; чужие события — без действий', async () => {
    const { svc, gateway } = await sent();
    gateway.fetch.mockResolvedValue(null);
    await expect(svc.webhook(note('payout.succeeded'))).rejects.toThrow();
    expect(await svc.webhook({ event: 'payment.succeeded', object: { id: 'x' } })).toMatchObject({
      ignored: true,
    });
  });

  it('потерянное уведомление подбирает сверка', async () => {
    const { svc, rows, gateway } = await sent();
    rows.get('p1')!.updatedAt = new Date(Date.now() - 120_000);
    gateway.fetch.mockResolvedValue(result('succeeded'));
    await svc.sweep();
    expect(rows.get('p1')!.status).toBe('paid');
  });
});
