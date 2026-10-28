import { describe, expect, it, vi } from 'vitest';
import { parsePeriod } from '@gamemarket/shared';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { ReportsService } from '../src/modules/reports/reports.service';

/**
 * «Кошелёк» в кабинете: баланс с деньгами в пути (в сделках и на выводе) и
 * выписка по страницам с фильтром по типу операции — остаток после
 * операции считается по всему балансу, суммы фильтра — по его операциям.
 */

type Where = Record<string, unknown>;

describe('кошелёк', () => {
  it('в сделках — оплаченные и выданные продажи, на выводе — невыплаченные заявки', async () => {
    const orderWhere: Where[] = [];
    const payoutWhere: Where[] = [];
    const prisma = {
      order: {
        aggregate: vi.fn(async ({ where }: { where: Where }) => {
          orderWhere.push(where);
          return { _count: { _all: 2 }, _sum: { sellerPayoutAmount: 171000n } };
        }),
      },
      payout: {
        aggregate: vi.fn(async ({ where }: { where: Where }) => {
          payoutWhere.push(where);
          return { _count: { _all: 0 }, _sum: { amount: null } };
        }),
      },
    };
    const ledger = { balanceOf: vi.fn(async () => 50000n) };
    const svc = new WalletService(prisma as never, ledger as never);

    expect(await svc.getWallet('me')).toEqual({
      currency: 'RUB',
      balance: 50000n,
      inDeals: { count: 2, amount: 171000n },
      withdrawing: { count: 0, amount: 0n },
    });
    expect(orderWhere[0]).toEqual({
      sellerId: 'me',
      currency: 'RUB',
      status: { in: ['paid', 'delivered'] },
    });
    expect(payoutWhere[0]).toEqual({
      userId: 'me',
      currency: 'RUB',
      status: { in: ['requested', 'approved', 'processing'] },
    });
  });
});

describe('выписка по страницам и по типу операции', () => {
  const p = parsePeriod('2026-10-01', '2026-10-31');
  if ('error' in p) throw new Error(p.error);
  const at = (day: number) => new Date(Date.UTC(2026, 9, day, 9));

  // Операции за октябрь по порядку; до периода на балансе было 100 ₽.
  const entries = [
    { refType: 'balance_topup', direction: 'credit', amount: 50000n, day: 2 },
    { refType: 'order_release', direction: 'credit', amount: 90000n, day: 5 },
    { refType: 'payout_hold', direction: 'debit', amount: 30000n, day: 6 },
    { refType: 'order_release', direction: 'credit', amount: 40000n, day: 8 },
    { refType: 'promotion', direction: 'debit', amount: 5000n, day: 9 },
    { refType: 'payout_reverse', direction: 'credit', amount: 30000n, day: 10 },
  ].map((e, i) => ({
    id: `e${i + 1}`,
    direction: e.direction,
    amount: e.amount,
    refType: e.refType,
    createdAt: at(e.day),
    orderId: e.refType === 'order_release' ? `o${i + 1}` : null,
    order: e.refType === 'order_release' ? { publicNumber: `GM-${i + 1}` } : null,
  }));

  function setup() {
    const inRange = (d: Date, w: { gte?: Date; lt: Date }) => (!w.gte || d >= w.gte) && d < w.lt;
    const prisma = {
      ledgerAccount: { findMany: vi.fn(async () => [{ id: 'a1' }]) },
      ledgerEntry: {
        groupBy: vi.fn(async ({ where }: { where: { createdAt: { gte?: Date; lt: Date } } }) => {
          if (!where.createdAt.gte) return [{ direction: 'credit', _sum: { amount: 10000n } }];
          const sum = (d: string) =>
            entries
              .filter((e) => e.direction === d && inRange(e.createdAt, where.createdAt))
              .reduce((a, e) => a + e.amount, 0n);
          return [
            { direction: 'credit', _sum: { amount: sum('credit') } },
            { direction: 'debit', _sum: { amount: sum('debit') } },
          ];
        }),
        findMany: vi.fn(async () => entries),
      },
      order: {
        aggregate: vi.fn(async () => ({
          _count: { _all: 2 },
          _sum: { amount: 150000n, sellerPayoutAmount: 130000n },
        })),
      },
    };
    return new ReportsService(prisma as never);
  }

  it('новые сверху, по страницам; итоги — за весь период', async () => {
    const svc = setup();
    const first = await svc.statement('me', p, { limit: 4 });
    expect(first).toMatchObject({
      opening: 10000n,
      credits: 210000n,
      debits: 35000n,
      closing: 185000n,
      total: 6,
      more: true,
    });
    expect(first.rows.map((r) => [r.id, r.balance])).toEqual([
      ['e6', 185000n],
      ['e5', 155000n],
      ['e4', 160000n],
      ['e3', 120000n],
    ]);
    const second = await svc.statement('me', p, { offset: 4, limit: 4 });
    expect(second.rows.map((r) => r.id)).toEqual(['e2', 'e1']);
    expect(second.more).toBe(false);
  });

  it('фильтр: только операции группы, их суммы; остаток после операции — по всему балансу', async () => {
    const svc = setup();
    const sales = await svc.statement('me', p, { kind: 'sales' });
    expect(sales.rows.map((r) => [r.orderNumber, r.amount, r.balance])).toEqual([
      ['GM-4', 40000n, 160000n],
      ['GM-2', 90000n, 150000n],
    ]);
    expect(sales).toMatchObject({ total: 2, shown: { credits: 130000n, debits: 0n }, more: false });
    expect(sales.closing).toBe(185000n);

    const payouts = await svc.statement('me', p, { kind: 'payouts' });
    expect(payouts.rows.map((r) => r.refType)).toEqual(['payout_reverse', 'payout_hold']);
    expect(payouts.shown).toEqual({ credits: 30000n, debits: 30000n });
  });

  it('файлом — тоже по типу: в имени файла группа, итоги внизу — по балансу', async () => {
    const svc = setup();
    const file = await svc.statementCsv('me', p, 'ru', 'promotion');
    expect(file.name).toBe('gamemarket-statement-promotion-2026-10-01-2026-10-31.csv');
    const lines = file.csv.split('\r\n');
    expect(lines.filter((l) => l.includes('Продвижение лота'))).toHaveLength(1);
    expect(lines.some((l) => l.includes('Зачисление за продажу'))).toBe(false);
    expect(lines.find((l) => l.startsWith('Остаток на конец'))).toBe(
      'Остаток на конец;;;;;1850,00',
    );
  });
});
