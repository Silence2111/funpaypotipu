import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayoutsService } from '../src/modules/payouts/payouts.service';
import { YooKassaPayouts, type GatewayPayout } from '../src/modules/payouts/yookassa-payouts';

/**
 * Выплаты через ЮKassa. Проверяется: реквизиты СБП и ЮMoney проверяются
 * при заявке; одобрение отправляет сумму «на руки» один раз; «выплачено» —
 * только после подтверждения шлюза со сверкой суммы; отмена возвращает
 * деньги на баланс; карта по-прежнему вручную; потерянное уведомление
 * подбирает сверка.
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
  it('СБП и ЮMoney — сам, карта и USDT — вручную; без ключей — всё вручную', () => {
    const g = new YooKassaPayouts();
    expect(['sbp', 'yoomoney', 'card', 'usdt'].map((m) => g.handles(m))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    delete process.env.YOOKASSA_PAYOUT_SECRET_KEY;
    expect(g.handles('sbp')).toBe(false);
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
  };
  const audit = { log: vi.fn(async () => undefined) };
  const notifications = { notify: vi.fn(async () => undefined) };
  const gateway = {
    enabled: true,
    handles: (m: string) => m === 'sbp' || m === 'yoomoney',
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
  return { svc, rows, ledger, posted, notifications, gateway };
}

const AMOUNT = 100_000n; // 1000 ₽, СБП 2,5% → комиссия 25 ₽, на руки 975 ₽

describe('заявка и одобрение', () => {
  it('СБП: телефон приводится к 7XXXXXXXXXX, банк обязателен и из списка', async () => {
    const { svc, rows } = setup();
    await expect(svc.request('u1', AMOUNT, 'sbp', '+7 900 123-45-67')).rejects.toThrow(
      /Выберите банк/,
    );
    await expect(
      svc.request('u1', AMOUNT, 'sbp', '+7 900 123-45-67', 'RUB', 'nope'),
    ).rejects.toThrow(/Выберите банк/);
    await expect(svc.request('u1', AMOUNT, 'sbp', '123', 'RUB', '100000000111')).rejects.toThrow(
      /Телефон для СБП/,
    );
    await svc.request('u1', AMOUNT, 'sbp', '8 (900) 123-45-67', 'RUB', '100000000111');
    expect(rows.get('p1')!.destinationEnc).toBe(
      'enc:{"phone":"79001234567","bankId":"100000000111"}',
    );
  });

  it('одобрение отправляет сумму «на руки» и ждёт подтверждения; второе одобрение — отказ', async () => {
    const { svc, rows, gateway, posted } = setup();
    await svc.request('u1', AMOUNT, 'sbp', '+79001234567', 'RUB', '100000000111');
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

  it('карта — вручную, как раньше: одобрение сразу «выплачено»', async () => {
    const { svc, gateway, posted } = setup();
    await svc.request('u1', AMOUNT, 'card', '4111111111111111');
    expect(await svc.approve('p1', 'fin')).toMatchObject({ status: 'paid' });
    expect(gateway.create).not.toHaveBeenCalled();
    expect(posted.has('payout_settle:p1')).toBe(true);
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
    await ctx.svc.request('u1', AMOUNT, 'sbp', '+79001234567', 'RUB', '100000000111');
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
