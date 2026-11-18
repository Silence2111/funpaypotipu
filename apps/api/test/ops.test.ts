import { afterEach, describe, expect, it, vi } from 'vitest';
import { fingerprint, normalizeMessage } from '../src/modules/ops/fingerprint';
import { ReconciliationService } from '../src/modules/ops/reconciliation.service';
import { OpsAlertService } from '../src/modules/ops/ops-alert.service';
import { MonitoringLogger } from '../src/modules/ops/monitoring.logger';
import { setOpsSink, type OpsErrorInput } from '../src/modules/ops/ops-signal';

/**
 * Сверка с ЮKassa, сбор ошибок и тревоги (части 129–130): что считается
 * расхождением, как ошибки складываются в группы, почему тревога не шлётся
 * дважды и что журнал API отдаёт в сбор.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000);

describe('отпечаток ошибки', () => {
  it('id, числа и почты не дробят группу; другое место в коде — другая группа', () => {
    expect(normalizeMessage(`Заказ ${id(1)} на 1500.50 ₽ для a.b@mail.ru не найден`)).toBe(
      'Заказ <id> на <n> ₽ для <email> не найден',
    );
    const stack = (fn: string) =>
      `Error: x\n    at ${fn} (/app/dist/modules/orders/orders.service.js:10:5)\n    at node:internal/x`;
    const a = fingerprint('api', `Заказ ${id(1)} не найден`, stack('A'));
    const b = fingerprint('api', `Заказ ${id(2)} не найден`, stack('A'));
    const c = fingerprint('api', `Заказ ${id(2)} не найден`, stack('B'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(fingerprint('web', 'x')).not.toBe(fingerprint('api', 'x'));
  });
});

describe('сверка с ЮKassa', () => {
  type Pay = {
    id: string;
    providerRef: string;
    externalId: string | null;
    amount: bigint;
    currency: string;
    status: string;
    orderId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  const pay = (n: number, status: string, ext: string | null, amount = 100000n): Pay => ({
    id: id(n),
    providerRef: `ref-${n}`,
    externalId: ext,
    amount,
    currency: 'RUB',
    status,
    orderId: null,
    createdAt: at(180),
    updatedAt: at(180),
  });

  function setup(
    ours: Pay[],
    gw: Array<{ id: string; status: string; amount: bigint; providerRef?: string }>,
    refunds: Array<{ id: string; paymentId: string; amount: bigint }> = [],
  ) {
    const issues: Array<{ kind: string; ref: string }> = [];
    const prisma = {
      reconciliationRun: {
        create: vi.fn(async ({ data }: { data: object }) => ({ id: id(900), ...data })),
        update: vi.fn(async ({ data }: { data: object }) => ({ id: id(900), ...data })),
      },
      reconciliationIssue: {
        findUnique: vi.fn(
          async ({ where }: { where: { kind_ref: { kind: string; ref: string } } }) =>
            issues.find((i) => i.kind === where.kind_ref.kind && i.ref === where.kind_ref.ref)
              ? { id: id(901) }
              : null,
        ),
        create: vi.fn(async ({ data }: { data: { kind: string; ref: string } }) =>
          issues.push(data),
        ),
        update: vi.fn(async () => ({})),
      },
      payment: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.status === 'refunded') return ours.filter((p) => p.status === 'refunded');
          if (where.OR || where.externalId) return [];
          return ours;
        }),
      },
      order: { findMany: vi.fn(async () => []) },
      payout: { findMany: vi.fn(async () => []) },
      dealPayout: { findMany: vi.fn(async () => []) },
    };
    const yk = {
      enabled: true,
      listPayments: vi.fn(async () => ({
        complete: true,
        items: gw.map((g) => ({
          id: g.id,
          status: g.status,
          amount: g.amount,
          currency: 'RUB',
          metadata: g.providerRef ? { providerRef: g.providerRef } : {},
          createdAt: at(180),
        })),
      })),
      listRefunds: vi.fn(async () => ({
        complete: true,
        items: refunds.map((r) => ({
          ...r,
          status: 'succeeded',
          currency: 'RUB',
          createdAt: at(150),
        })),
      })),
    };
    const alerts = { alert: vi.fn(async () => true) };
    const svc = new ReconciliationService(
      prisma as never,
      yk as never,
      { enabled: false } as never,
      {} as never,
      alerts as never,
      {} as never,
    );
    return { svc, issues, alerts };
  }

  it('сходится — расхождений нет, тревоги нет', async () => {
    const { svc, issues, alerts } = setup(
      [pay(1, 'succeeded', 'yk-1')],
      [{ id: 'yk-1', status: 'succeeded', amount: 100000n }],
    );
    const run = await svc.run({ trigger: 'manual' });
    expect(run).toMatchObject({ status: 'ok', newIssues: 0 });
    expect(issues).toEqual([]);
    expect(alerts.alert).not.toHaveBeenCalled();
  });

  it('деньги пришли, а платёж не проведён; оплачен у нас, а у ЮKassa нет; у ЮKassa есть, у нас нет; сумма разная', async () => {
    const { svc, issues, alerts } = setup(
      [
        pay(1, 'pending', 'yk-1'),
        pay(2, 'succeeded', 'yk-2'),
        pay(3, 'succeeded', 'yk-3', 50000n),
        pay(4, 'failed', null),
      ],
      [
        { id: 'yk-1', status: 'succeeded', amount: 100000n },
        { id: 'yk-3', status: 'succeeded', amount: 49900n },
        { id: 'yk-9', status: 'succeeded', amount: 1000n },
        { id: 'yk-4', status: 'canceled', amount: 100000n, providerRef: 'ref-4' },
      ],
    );
    const run = await svc.run({ trigger: 'manual' });
    expect(issues.map((i) => `${i.kind}:${i.ref}`).sort()).toEqual(
      [
        `amount_mismatch:${id(3)}`,
        'gateway_only:yk-9',
        `not_credited:${id(1)}`,
        `ours_only:${id(2)}`,
      ].sort(),
    );
    expect(run).toMatchObject({ status: 'issues', newIssues: 4 });
    expect(alerts.alert).toHaveBeenCalledWith(
      'reconcile',
      expect.stringContaining('новых расхождений — 4'),
    );
  });

  it('повторный прогон то же расхождение не дублирует и тревогу не шлёт', async () => {
    const { svc, issues, alerts } = setup(
      [pay(1, 'pending', 'yk-1')],
      [{ id: 'yk-1', status: 'succeeded', amount: 100000n }],
    );
    await svc.run({ trigger: 'manual' });
    const again = await svc.run({ trigger: 'manual' });
    expect(issues).toHaveLength(1);
    expect(again).toMatchObject({ status: 'issues', newIssues: 0 });
    expect(alerts.alert).toHaveBeenCalledTimes(1);
  });

  it('возврат у нас без возврата у ЮKassa и возврат у ЮKassa, о котором мы не знаем', async () => {
    const refunded = { ...pay(5, 'refunded', 'yk-5'), updatedAt: at(150) };
    const { svc, issues } = setup(
      [refunded, pay(6, 'succeeded', 'yk-6')],
      [
        { id: 'yk-5', status: 'succeeded', amount: 100000n },
        { id: 'yk-6', status: 'succeeded', amount: 100000n },
      ],
      [{ id: 'rf-x', paymentId: 'yk-6', amount: 100000n }],
    );
    await svc.run({ trigger: 'manual' });
    expect(issues.map((i) => i.kind).sort()).toEqual(['refund_missing', 'refund_unknown']);
  });

  it('без ключей ЮKassa и без её платежей — «сверять не с чем», не ошибка', async () => {
    const { svc } = setup([], []);
    (svc as unknown as { yk: { enabled: boolean } }).yk.enabled = false;
    expect(await svc.run({ trigger: 'auto' })).toMatchObject({ status: 'skipped' });
  });
});

describe('тревоги', () => {
  afterEach(() => {
    delete process.env.ALERT_BOT_TOKEN;
    delete process.env.ALERT_CHAT_ID;
    vi.unstubAllGlobals();
  });

  it('одна и та же тревога — не чаще раза в полчаса; в Telegram — когда задан бот', async () => {
    process.env.ALERT_BOT_TOKEN = 'bot';
    process.env.ALERT_CHAT_ID = '42';
    const fetchMock = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const rows: Array<{ key: string; createdAt: Date }> = [];
    const prisma = {
      opsAlert: {
        findFirst: vi.fn(
          async ({ where }: { where: { key: string; createdAt: { gt: Date } } }) =>
            rows.find((r) => r.key === where.key && r.createdAt > where.createdAt.gt) ?? null,
        ),
        create: vi.fn(async ({ data }: { data: { key: string } }) => {
          const row = { id: id(rows.length + 1), ...data, createdAt: new Date() };
          rows.push(row);
          return row;
        }),
        update: vi.fn(async () => ({})),
      },
    };
    const svc = new OpsAlertService(prisma as never);
    expect(await svc.alert('payments', 'пять оплат подряд')).toBe(true);
    expect(await svc.alert('payments', 'пять оплат подряд')).toBe(false);
    expect(await svc.alert('errors', 'всплеск')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(body).toMatchObject({
      chat_id: '42',
      text: expect.stringContaining('пять оплат подряд'),
    });
    // Через полчаса — снова можно.
    rows[0]!.createdAt = new Date(Date.now() - 31 * 60_000);
    expect(await svc.alert('payments', 'снова')).toBe(true);
  });
});

describe('журнал API → сбор ошибок', () => {
  afterEach(() => setOpsSink(null));

  it('ошибка со стеком и источником уходит в сбор; обработчик исключений — нет (он пишет сам, с адресом)', () => {
    const got: OpsErrorInput[] = [];
    setOpsSink({ error: (i) => got.push(i), event: () => {} });
    const logger = new MonitoringLogger();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.error('ЮKassa не ответила', 'Error: x\n    at f (a.js:1:1)', 'PayoutsService');
    logger.error('Сбой', 'ExceptionsHandler');
    logger.error(new Error('упало'));
    expect(got.map((g) => [g.message, g.context])).toEqual([
      ['ЮKassa не ответила', 'PayoutsService'],
      ['упало', null],
    ]);
    expect(got[0]!.stack).toContain('at f');
    vi.restoreAllMocks();
  });
});
