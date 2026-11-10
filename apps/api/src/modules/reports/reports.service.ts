import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@gamemarket/db';
import {
  csvDate,
  csvMoney,
  mskDay,
  operationKindRefTypes,
  operationLabel,
  parsePeriod,
  toCsv,
  translateText,
  EN_SHARED,
  type CsvCell,
  type OperationKind,
  type Period,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { say } from '../../i18n/texts';
import type { Lang } from '../../i18n/lang';

const CURRENCY = 'RUB';
/** Сколько строк выписки отдавать за раз; дальше — «Показать ещё», в файле — все. */
const PAGE_ROWS = 50;
/** Предел строк в одном файле: больше — разбить период. */
const MAX_ROWS = 20_000;
const DAY_MS = 86400_000;

type Sum = { credit: bigint; debit: bigint };

/** Подпись операции на языке файла. */
const opLabel = (refType: string | null, lang: Lang) => {
  const ru = operationLabel(refType);
  return lang === 'en' ? (translateText(EN_SHARED, ru) ?? ru) : ru;
};

/**
 * Отчёты: выписка по балансу и выгрузка продаж для продавца (самозанятому —
 * для «Мой налог»), сводка оборота для владельца. Деньги — из проводок
 * журнала, а не из заказов: выписка сходится с балансом до копейки.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  period(from?: string, to?: string): Period {
    const p = parsePeriod(from, to);
    if ('error' in p) throw new BadRequestException(p.error);
    return p;
  }

  private async sums(where: Prisma.LedgerEntryWhereInput): Promise<Sum> {
    const g = await this.prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where,
      _sum: { amount: true },
    });
    const of = (d: string) => g.find((x) => x.direction === d)?._sum.amount ?? 0n;
    return { credit: of('credit'), debit: of('debit') };
  }

  /** Операции по балансу за период с остатком после каждой. */
  private async ledger(userId: string, p: Period, limit: number) {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { ownerType: 'user', ownerId: userId, kind: 'available', currency: CURRENCY },
      select: { id: true },
    });
    const accountId = { in: accounts.map((a) => a.id) };
    const before = await this.sums({ accountId, createdAt: { lt: p.from } });
    const within = await this.sums({ accountId, createdAt: { gte: p.from, lt: p.to } });
    const opening = before.credit - before.debit;
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { accountId, createdAt: { gte: p.from, lt: p.to } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        direction: true,
        amount: true,
        refType: true,
        createdAt: true,
        orderId: true,
        order: { select: { publicNumber: true } },
      },
    });
    let balance = opening;
    const rows = entries.map((e) => {
      const amount = e.direction === 'credit' ? e.amount : -e.amount;
      balance += amount;
      return {
        id: e.id,
        createdAt: e.createdAt,
        refType: e.refType,
        orderId: e.orderId,
        orderNumber: e.order?.publicNumber ?? null,
        amount,
        balance,
      };
    });
    return {
      opening,
      credits: within.credit,
      debits: within.debit,
      closing: opening + within.credit - within.debit,
      rows,
    };
  }

  private salesWhere(sellerId: string, p: Period): Prisma.OrderWhereInput {
    return { sellerId, status: 'completed', completedAt: { gte: p.from, lt: p.to } };
  }

  /**
   * Выписка для страницы: итоги, продажи за период и операции — новые
   * сверху, по страницам. С `kind` — только операции этой группы и их суммы;
   * остаток после операции и итоги периода — по всему балансу.
   */
  async statement(
    userId: string,
    p: Period,
    opts: { kind?: OperationKind; offset?: number; limit?: number } = {},
  ) {
    const { kind, offset = 0, limit = PAGE_ROWS } = opts;
    const [l, sales] = await Promise.all([
      this.ledger(userId, p, MAX_ROWS),
      this.prisma.order.aggregate({
        where: this.salesWhere(userId, p),
        _count: { _all: true },
        _sum: { amount: true, sellerPayoutAmount: true },
      }),
    ]);
    return {
      from: p.fromDay,
      to: p.toDay,
      currency: CURRENCY,
      opening: l.opening,
      credits: l.credits,
      debits: l.debits,
      closing: l.closing,
      sales: {
        count: sales._count._all,
        gross: sales._sum.amount ?? 0n,
        payout: sales._sum.sellerPayoutAmount ?? 0n,
      },
      ...this.page(this.only(l.rows, kind), offset, limit),
    };
  }

  /** Операции группы; без группы — все. */
  private only<R extends { refType: string | null }>(rows: R[], kind?: OperationKind): R[] {
    if (!kind) return rows;
    const refTypes = operationKindRefTypes(kind);
    return rows.filter((r) => r.refType !== null && refTypes.includes(r.refType));
  }

  /** Страница выписки: новые сверху; суммы — по всем подходящим операциям. */
  private page<R extends { amount: bigint }>(rows: R[], offset: number, limit: number) {
    let credits = 0n;
    let debits = 0n;
    for (const r of rows) {
      if (r.amount > 0n) credits += r.amount;
      else debits -= r.amount;
    }
    const newest = rows.slice().reverse();
    return {
      shown: { credits, debits },
      total: rows.length,
      rows: newest.slice(offset, offset + limit),
      more: offset + limit < rows.length,
    };
  }

  /**
   * Выписка файлом: операции по порядку, внизу — остатки и обороты. С `kind`
   * — только операции группы, остатки и обороты — по всему балансу.
   */
  async statementCsv(userId: string, p: Period, lang: Lang, kind?: OperationKind) {
    const l = await this.ledger(userId, p, MAX_ROWS);
    const m = (v: bigint) => csvMoney(v, lang);
    const rows: CsvCell[][] = [
      [
        say(lang, 'Дата (МСК)'),
        say(lang, 'Операция'),
        say(lang, 'Заказ'),
        say(lang, 'Приход'),
        say(lang, 'Расход'),
        say(lang, 'Остаток'),
      ],
      ...this.only(l.rows, kind).map((r) => [
        csvDate(r.createdAt, lang),
        opLabel(r.refType, lang),
        r.orderNumber,
        r.amount > 0n ? m(r.amount) : null,
        r.amount < 0n ? m(-r.amount) : null,
        m(r.balance),
      ]),
      [],
      [say(lang, 'Остаток на начало'), null, null, null, null, m(l.opening)],
      [say(lang, 'Поступило'), null, null, m(l.credits)],
      [say(lang, 'Списано'), null, null, null, m(l.debits)],
      [say(lang, 'Остаток на конец'), null, null, null, null, m(l.closing)],
    ];
    const name = `gamemarket-statement-${kind ? `${kind}-` : ''}${p.fromDay}-${p.toDay}.csv`;
    return { csv: toCsv(rows, lang), name };
  }

  /** Продажи за период файлом — доход продавца по завершённым сделкам. */
  async salesCsv(sellerId: string, p: Period, lang: Lang) {
    const orders = await this.prisma.order.findMany({
      where: this.salesWhere(sellerId, p),
      orderBy: { completedAt: 'asc' },
      take: MAX_ROWS,
      select: {
        publicNumber: true,
        completedAt: true,
        qty: true,
        amount: true,
        sellerPayoutAmount: true,
        listingSnapshot: true,
        buyer: { select: { profile: { select: { username: true } } } },
      },
    });
    const m = (v: bigint) => csvMoney(v, lang);
    let gross = 0n;
    let payout = 0n;
    const rows: CsvCell[][] = [
      [
        say(lang, 'Дата зачисления (МСК)'),
        say(lang, 'Заказ'),
        say(lang, 'Лот'),
        say(lang, 'Покупатель'),
        say(lang, 'Количество'),
        say(lang, 'Оплатил покупатель'),
        say(lang, 'Комиссия площадки'),
        say(lang, 'Зачислено вам'),
      ],
      ...orders.map((o) => {
        gross += o.amount;
        payout += o.sellerPayoutAmount;
        return [
          csvDate(o.completedAt!, lang),
          o.publicNumber,
          (o.listingSnapshot as { title?: string } | null)?.title ?? '',
          o.buyer.profile?.username ?? '',
          o.qty,
          m(o.amount),
          m(o.amount - o.sellerPayoutAmount),
          m(o.sellerPayoutAmount),
        ];
      }),
      [],
      [say(lang, 'Итого'), orders.length, null, null, null, m(gross), m(gross - payout), m(payout)],
    ];
    return { csv: toCsv(rows, lang), name: `gamemarket-sales-${p.fromDay}-${p.toDay}.csv` };
  }

  /** Последние `days` дней по Москве, включая сегодня. */
  platformPeriod(days: number): Period {
    if (!Number.isInteger(days) || days < 1 || days > 366) {
      throw new BadRequestException('Период — от 1 до 366 дней');
    }
    const now = new Date();
    return this.period(mskDay(new Date(now.getTime() - (days - 1) * DAY_MS)), mskDay(now));
  }

  /**
   * Сводка для владельца: оборот и доход площадки, заказы, люди, выплаты,
   * деньги на балансах и в сделках, по дням — для графика.
   */
  async platform(p: Period) {
    const range = { gte: p.from, lt: p.to };
    const completed: Prisma.OrderWhereInput = { status: 'completed', completedAt: range };
    const revenueAccounts = await this.prisma.ledgerAccount.findMany({
      where: { ownerType: 'platform', kind: 'revenue', currency: CURRENCY },
      select: { id: true },
    });
    const revenueIds = revenueAccounts.map((a) => a.id);
    const [
      done,
      created,
      paid,
      refunded,
      disputes,
      newUsers,
      sellers,
      buyers,
      revenue,
      payoutsPaid,
      payoutsPending,
      userBalances,
      escrow,
      dailyOrders,
      dailyRevenue,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: completed,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.order.count({ where: { createdAt: range } }),
      this.prisma.order.count({ where: { paidAt: range } }),
      this.prisma.order.count({ where: { status: 'refunded', updatedAt: range } }),
      this.prisma.dispute.count({ where: { createdAt: range } }),
      this.prisma.user.count({ where: { createdAt: range } }),
      this.prisma.order.findMany({
        where: completed,
        distinct: ['sellerId'],
        select: { sellerId: true },
      }),
      this.prisma.order.findMany({
        where: completed,
        distinct: ['buyerId'],
        select: { buyerId: true },
      }),
      this.sums({ accountId: { in: revenueIds }, createdAt: range }),
      this.prisma.payout.aggregate({
        where: { status: 'paid', updatedAt: range },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.payout.aggregate({
        where: { status: { in: ['requested', 'approved', 'processing'] } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.ledgerAccount.aggregate({
        where: { ownerType: 'user', kind: 'available', currency: CURRENCY },
        _sum: { balance: true },
      }),
      this.prisma.ledgerAccount.aggregate({
        where: { ownerType: 'platform', kind: 'escrow', currency: CURRENCY },
        _sum: { balance: true },
      }),
      this.prisma.$queryRaw<Array<{ day: string; orders: bigint; gmv: string | null }>>`
        SELECT to_char(completed_at + interval '3 hours', 'YYYY-MM-DD') AS day,
               count(*) AS orders, sum(amount)::text AS gmv
        FROM orders
        WHERE status = 'completed' AND completed_at >= ${p.from} AND completed_at < ${p.to}
        GROUP BY 1`,
      revenueIds.length
        ? this.prisma.$queryRaw<Array<{ day: string; net: string | null }>>`
            SELECT to_char(created_at + interval '3 hours', 'YYYY-MM-DD') AS day,
                   sum(CASE WHEN direction = 'credit' THEN amount ELSE -amount END)::text AS net
            FROM ledger_entries
            WHERE account_id = ANY(${revenueIds}::uuid[])
              AND created_at >= ${p.from} AND created_at < ${p.to}
            GROUP BY 1`
        : Promise.resolve([] as Array<{ day: string; net: string | null }>),
    ]);

    const byDay = new Map(dailyOrders.map((d) => [d.day, d]));
    const revByDay = new Map(dailyRevenue.map((d) => [d.day, BigInt(d.net ?? '0')]));
    const daily: Array<{ day: string; orders: number; gmv: bigint; revenue: bigint }> = [];
    for (let t = p.from.getTime(); t < p.to.getTime(); t += DAY_MS) {
      const day = mskDay(new Date(t));
      const o = byDay.get(day);
      daily.push({
        day,
        orders: Number(o?.orders ?? 0),
        gmv: BigInt(o?.gmv ?? '0'),
        revenue: revByDay.get(day) ?? 0n,
      });
    }
    const gmv = done._sum.amount ?? 0n;
    const count = done._count._all;
    return {
      from: p.fromDay,
      to: p.toDay,
      currency: CURRENCY,
      gmv,
      revenue: revenue.credit - revenue.debit,
      avgOrder: count ? gmv / BigInt(count) : 0n,
      orders: { created, paid, completed: count, refunded, disputes },
      users: { new: newUsers, activeSellers: sellers.length, activeBuyers: buyers.length },
      payouts: {
        paidCount: payoutsPaid._count._all,
        paidSum: payoutsPaid._sum.amount ?? 0n,
        pendingCount: payoutsPending._count._all,
        pendingSum: payoutsPending._sum.amount ?? 0n,
      },
      balances: {
        users: userBalances._sum.balance ?? 0n,
        escrow: escrow._sum.balance ?? 0n,
      },
      daily,
    };
  }

  async platformCsv(p: Period, lang: Lang) {
    const s = await this.platform(p);
    const m = (v: bigint) => csvMoney(v, lang);
    const rows: CsvCell[][] = [
      [
        say(lang, 'День'),
        say(lang, 'Сделок завершено'),
        say(lang, 'Оборот'),
        say(lang, 'Доход площадки'),
      ],
      ...s.daily.map((d) => [d.day, d.orders, m(d.gmv), m(d.revenue)]),
      [],
      [say(lang, 'Итого'), s.orders.completed, m(s.gmv), m(s.revenue)],
    ];
    return { csv: toCsv(rows, lang), name: `gamemarket-summary-${p.fromDay}-${p.toDay}.csv` };
  }
}
