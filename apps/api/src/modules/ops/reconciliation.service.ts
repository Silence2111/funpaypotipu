import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { computeWithdrawalFee, getWithdrawalMethod } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { AuditService } from '../access/audit.service';
import { CARD_CHECK_PURPOSE, YooKassaProvider } from '../payments/yookassa.provider';
import { YooKassaPayouts } from '../payouts/yookassa-payouts';
import { YooKassaDealGateway } from '../safe-deal/deal.gateway';
import { OpsAlertService } from './ops-alert.service';

const HOUR = 3_600_000;
/** Раз в столько часов — сама; проверка, не пора ли, — раз в час. */
const EVERY_H = Number(process.env.RECONCILE_EVERY_H ?? 24);
const CHECK_MS = Number(process.env.RECONCILE_CHECK_MS ?? HOUR);
/** Сколько свежих минут не сверять: платёж мог ещё не дойти до конца. */
const lagMs = () => Number(process.env.RECONCILE_LAG_MIN ?? 60) * 60_000;
/** Сколько записей выплат проверять по одной за прогон — дальше хватит следующего. */
const PAYOUT_CAP = 300;

export type IssueKind =
  | 'gateway_only'
  | 'ours_only'
  | 'not_credited'
  | 'status_mismatch'
  | 'amount_mismatch'
  | 'refund_missing'
  | 'refund_unknown'
  | 'refund_amount'
  | 'payout_mismatch'
  | 'payout_stuck';

/** Что значит расхождение — для тревоги и консоли. */
export const ISSUE_TEXT: Record<IssueKind, string> = {
  gateway_only: 'ЮKassa приняла оплату, а у нас такого платежа нет',
  ours_only: 'у нас платёж оплачен, а у ЮKassa его нет',
  not_credited: 'ЮKassa приняла оплату, а у нас платёж не проведён',
  status_mismatch: 'статус у нас и у ЮKassa разный',
  amount_mismatch: 'сумма у нас и у ЮKassa разная',
  refund_missing: 'у нас возврат сделан, а у ЮKassa его нет',
  refund_unknown: 'у ЮKassa возврат, о котором мы не знаем',
  refund_amount: 'сумма возврата у ЮKassa не та',
  payout_mismatch: 'выплата у нас и у ЮKassa не сходится',
  payout_stuck: 'ЮKassa уже закончила выплату, а у нас она всё ещё «отправляется»',
};

interface Found {
  kind: IssueKind;
  entity: 'payment' | 'refund' | 'payout' | 'deal_payout';
  ref: string;
  ourId?: string | null;
  externalId?: string | null;
  ours?: Record<string, unknown> | null;
  theirs?: Record<string, unknown> | null;
}

type OurPayment = {
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

const money = (v: bigint | null | undefined) =>
  v === null || v === undefined ? null : v.toString();

/**
 * Ежедневная сверка с ЮKassa (часть 129): оплаты, возвраты, выплаты и
 * выплаты по «Безопасной сделке» в нашем учёте — против того, что знает
 * шлюз. Окно — сутки с запасом, кроме последнего часа: свежий платёж мог
 * ещё не дойти до конца. Расхождение записывается один раз и видно в
 * консоли «Сверка и сбои», новое — ещё и тревогой в Telegram. Сама — раз в
 * сутки, по кнопке — когда нужно.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private running = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly yk: YooKassaProvider,
    private readonly ykPayouts: YooKassaPayouts,
    private readonly deals: YooKassaDealGateway,
    private readonly alerts: OpsAlertService,
    private readonly audit: AuditService,
  ) {}

  @Interval('reconciliation', CHECK_MS)
  async tick() {
    if (process.env.RECONCILE_AUTO === 'off') return;
    const last = await this.prisma.reconciliationRun.findFirst({
      where: { trigger: 'auto' },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    if (last && Date.now() - last.startedAt.getTime() < EVERY_H * HOUR - 5 * 60_000) return;
    await this.run({ trigger: 'auto' });
  }

  /** Прогон за `hours` часов до «сейчас минус запас». Одновременно — один. */
  async run(opts: { trigger: 'auto' | 'manual'; hours?: number; by?: string | null; now?: Date }) {
    if (this.running) throw new BadRequestException('Сверка уже идёт — подождите минуту');
    this.running = true;
    const now = opts.now ?? new Date();
    const to = new Date(now.getTime() - lagMs());
    const from = new Date(to.getTime() - (opts.hours ?? EVERY_H + 2) * HOUR);
    const run = await this.prisma.reconciliationRun.create({
      data: { trigger: opts.trigger, windowFrom: from, windowTo: to, startedBy: opts.by ?? null },
    });
    try {
      const result = await this.compare(from, to, now);
      if (result.skipped) {
        return await this.prisma.reconciliationRun.update({
          where: { id: run.id },
          data: {
            status: 'skipped',
            error: result.skipped,
            finishedAt: new Date(),
            checked: result.checked,
          },
        });
      }
      let fresh = 0;
      for (const f of result.found) {
        const data = {
          entity: f.entity,
          ourId: f.ourId ?? null,
          externalId: f.externalId ?? null,
          ours: (f.ours ?? undefined) as Prisma.InputJsonValue | undefined,
          theirs: (f.theirs ?? undefined) as Prisma.InputJsonValue | undefined,
        };
        const existing = await this.prisma.reconciliationIssue.findUnique({
          where: { kind_ref: { kind: f.kind, ref: f.ref } },
          select: { id: true },
        });
        if (existing) {
          await this.prisma.reconciliationIssue.update({
            where: { id: existing.id },
            data: { ...data, lastSeenAt: new Date() },
          });
        } else {
          await this.prisma.reconciliationIssue.create({
            data: { ...data, kind: f.kind, ref: f.ref, firstRunId: run.id },
          });
          fresh++;
        }
      }
      const done = await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: result.found.length ? 'issues' : 'ok',
          newIssues: fresh,
          checked: result.checked,
          finishedAt: new Date(),
          ...(result.partial ? { error: result.partial } : {}),
        },
      });
      if (fresh) {
        const kinds = [...new Set(result.found.map((f) => ISSUE_TEXT[f.kind]))]
          .slice(0, 3)
          .join('; ');
        await this.alerts.alert(
          'reconcile',
          `Сверка с ЮKassa: новых расхождений — ${fresh} (${kinds}). Консоль → «Сверка и сбои».`,
        );
      }
      return done;
    } catch (e) {
      const message = (e as Error).message;
      this.logger.warn(`Сверка не прошла: ${message}`);
      await this.alerts.alert('reconcile_error', `Сверка с ЮKassa не прошла: ${message}`);
      return this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: { status: 'error', error: message.slice(0, 500), finishedAt: new Date() },
      });
    } finally {
      this.running = false;
    }
  }

  private async compare(from: Date, to: Date, now: Date) {
    const found: Found[] = [];
    const checked = { payments: 0, refunds: 0, payouts: 0, dealPayouts: 0 };
    const select = {
      id: true,
      providerRef: true,
      externalId: true,
      amount: true,
      currency: true,
      status: true,
      orderId: true,
      createdAt: true,
      updatedAt: true,
    } as const;
    const ours: OurPayment[] = await this.prisma.payment.findMany({
      where: { provider: 'yookassa', createdAt: { gte: from, lt: to } },
      select,
    });
    if (!this.yk.enabled) {
      if (!ours.length)
        return {
          found,
          checked,
          skipped: 'ЮKassa не подключена — сверять не с чем',
          partial: null,
        };
      throw new Error('платежи ЮKassa есть, а ключей магазина нет');
    }
    let partial: string | null = null;

    // ── Оплаты ──
    const gw = await this.yk.listPayments(
      new Date(from.getTime() - HOUR),
      new Date(to.getTime() + HOUR),
    );
    if (!gw.complete) partial = 'список платежей ЮKassa длиннее, чем сверка прошла';
    const inWindow = (d: Date | null) => !!d && d >= from && d < to;
    const gwPayments = gw.items.filter((p) => p.metadata.purpose !== CARD_CHECK_PURPOSE);
    // Наш платёж может быть создан чуть раньше окна, а у ЮKassa — уже в нём.
    const known = new Map<string, OurPayment>();
    for (const p of ours) {
      known.set(`ref:${p.providerRef}`, p);
      if (p.externalId) known.set(`ext:${p.externalId}`, p);
    }
    const missing = gwPayments.filter(
      (g) =>
        !known.has(`ext:${g.id}`) &&
        !(g.metadata.providerRef && known.has(`ref:${g.metadata.providerRef}`)),
    );
    if (missing.length) {
      const extra = await this.prisma.payment.findMany({
        where: {
          OR: [
            { externalId: { in: missing.map((g) => g.id) } },
            {
              providerRef: {
                in: missing.map((g) => g.metadata.providerRef).filter((v): v is string => !!v),
              },
            },
          ],
        },
        select,
      });
      for (const p of extra) {
        known.set(`ref:${p.providerRef}`, p);
        if (p.externalId) known.set(`ext:${p.externalId}`, p);
      }
    }
    const matched = new Set<string>();
    for (const g of gwPayments) {
      const our =
        known.get(`ext:${g.id}`) ??
        (g.metadata.providerRef ? known.get(`ref:${g.metadata.providerRef}`) : undefined);
      if (our) matched.add(our.id);
      const theirs = { id: g.id, status: g.status, amount: money(g.amount), currency: g.currency };
      const oursView = our
        ? {
            id: our.id,
            status: our.status,
            amount: money(our.amount),
            currency: our.currency,
            orderId: our.orderId,
          }
        : null;
      if (!our) {
        if (g.status === 'succeeded' && inWindow(g.createdAt)) {
          checked.payments++;
          found.push({
            kind: 'gateway_only',
            entity: 'payment',
            ref: g.id,
            externalId: g.id,
            theirs,
          });
        }
        continue;
      }
      if (!inWindow(our.createdAt) && !inWindow(g.createdAt)) continue;
      checked.payments++;
      const paidOurs = our.status === 'succeeded' || our.status === 'refunded';
      if (g.status === 'succeeded' && !paidOurs) {
        found.push({
          kind: 'not_credited',
          entity: 'payment',
          ref: our.id,
          ourId: our.id,
          externalId: g.id,
          ours: oursView,
          theirs,
        });
      } else if (
        g.status === 'canceled' &&
        (paidOurs || (our.status === 'pending' && now.getTime() - our.createdAt.getTime() > HOUR))
      ) {
        found.push({
          kind: 'status_mismatch',
          entity: 'payment',
          ref: our.id,
          ourId: our.id,
          externalId: g.id,
          ours: oursView,
          theirs,
        });
      } else if (
        g.status === 'succeeded' &&
        (g.amount !== our.amount || g.currency !== our.currency)
      ) {
        found.push({
          kind: 'amount_mismatch',
          entity: 'payment',
          ref: our.id,
          ourId: our.id,
          externalId: g.id,
          ours: oursView,
          theirs,
        });
      }
    }
    if (gw.complete) {
      for (const p of ours) {
        if (matched.has(p.id) || (p.status !== 'succeeded' && p.status !== 'refunded')) continue;
        checked.payments++;
        found.push({
          kind: 'ours_only',
          entity: 'payment',
          ref: p.id,
          ourId: p.id,
          externalId: p.externalId,
          ours: {
            id: p.id,
            status: p.status,
            amount: money(p.amount),
            currency: p.currency,
            orderId: p.orderId,
          },
        });
      }
    }

    // ── Возвраты ──
    // Возврат могли сделать позже оплаты: список ЮKassa — с запасом в двое суток.
    const refunds = await this.yk.listRefunds(
      new Date(from.getTime() - 48 * HOUR),
      new Date(to.getTime() + HOUR),
    );
    if (!refunds.complete) partial = 'список возвратов ЮKassa длиннее, чем сверка прошла';
    const refunded = new Map<string, bigint>();
    for (const r of refunds.items) {
      if (r.status === 'succeeded')
        refunded.set(r.paymentId, (refunded.get(r.paymentId) ?? 0n) + r.amount);
    }
    // Наши возвраты на карту: отмена «на способ оплаты» (часть 137) помечает
    // платёж refunded; возврат по сделке (часть 123) — заказ refunded с deal_id.
    const ourRefunded: OurPayment[] = await this.prisma.payment.findMany({
      where: {
        provider: 'yookassa',
        status: 'refunded',
        updatedAt: { gte: from, lt: to },
        externalId: { not: null },
      },
      select,
    });
    const dealRefunds = await this.prisma.order.findMany({
      where: { dealId: { not: null }, status: 'refunded', updatedAt: { gte: from, lt: to } },
      select: { id: true },
    });
    if (dealRefunds.length) {
      ourRefunded.push(
        ...(await this.prisma.payment.findMany({
          where: {
            provider: 'yookassa',
            orderId: { in: dealRefunds.map((o) => o.id) },
            status: { in: ['succeeded', 'refunded'] },
            externalId: { not: null },
          },
          select,
        })),
      );
    }
    const refundedIds = new Set<string>();
    for (const p of ourRefunded) {
      if (refundedIds.has(p.id)) continue;
      refundedIds.add(p.id);
      checked.refunds++;
      const sum = refunded.get(p.externalId!) ?? 0n;
      const view = {
        ours: { id: p.id, amount: money(p.amount), orderId: p.orderId },
        theirs: { paymentId: p.externalId, refunded: money(sum) },
      };
      if (sum === 0n) {
        if (refunds.complete)
          found.push({
            kind: 'refund_missing',
            entity: 'refund',
            ref: p.id,
            ourId: p.id,
            externalId: p.externalId,
            ...view,
          });
      } else if (sum !== p.amount) {
        found.push({
          kind: 'refund_amount',
          entity: 'refund',
          ref: p.id,
          ourId: p.id,
          externalId: p.externalId,
          ...view,
        });
      }
    }
    const strange = refunds.items.filter((r) => r.status === 'succeeded' && inWindow(r.createdAt));
    if (strange.length) {
      const byExt = new Map(
        (
          await this.prisma.payment.findMany({
            where: { externalId: { in: strange.map((r) => r.paymentId) } },
            select: { ...select, order: { select: { status: true, dealId: true } } },
          })
        ).map((p) => [p.externalId!, p]),
      );
      for (const r of strange) {
        const p = byExt.get(r.paymentId);
        if (p && refundedIds.has(p.id)) continue;
        // Возврат по сделке: заказ отменён — его учли выше по заказу.
        if (p?.order?.dealId && p.order.status === 'refunded') continue;
        if (p?.status === 'refunded') continue;
        checked.refunds++;
        found.push({
          kind: 'refund_unknown',
          entity: 'refund',
          ref: r.id,
          ourId: p?.id ?? null,
          externalId: r.id,
          ours: p
            ? { id: p.id, status: p.status, amount: money(p.amount), orderId: p.orderId }
            : null,
          theirs: {
            id: r.id,
            paymentId: r.paymentId,
            amount: money(r.amount),
            currency: r.currency,
          },
        });
      }
    }

    // ── Выплаты продавцам (вывод с баланса) ──
    if (this.ykPayouts.enabled) {
      const rows = await this.prisma.payout.findMany({
        where: {
          externalId: { not: null },
          OR: [{ updatedAt: { gte: from, lt: to } }, { status: 'processing' }],
        },
        orderBy: { updatedAt: 'desc' },
        take: PAYOUT_CAP,
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          status: true,
          externalId: true,
          updatedAt: true,
        },
      });
      for (const p of rows) {
        checked.payouts++;
        const g = await this.ykPayouts.fetch(p.externalId!);
        const wm = getWithdrawalMethod(p.method);
        const net = p.amount - (wm ? computeWithdrawalFee(p.amount, wm) : 0n);
        const ours = { id: p.id, status: p.status, amount: money(net), currency: p.currency };
        const theirs = g
          ? { id: g.id, status: g.status, amount: money(g.amount), currency: g.currency }
          : null;
        const base = {
          entity: 'payout' as const,
          ref: p.id,
          ourId: p.id,
          externalId: p.externalId,
          ours,
          theirs,
        };
        if (!g) {
          found.push({ kind: 'payout_mismatch', ...base });
        } else if (p.status === 'paid' && (g.status !== 'succeeded' || g.amount !== net)) {
          found.push({ kind: 'payout_mismatch', ...base });
        } else if (p.status === 'rejected' && g.status === 'succeeded') {
          found.push({ kind: 'payout_mismatch', ...base });
        } else if (
          p.status === 'processing' &&
          g.status !== 'pending' &&
          now.getTime() - p.updatedAt.getTime() > HOUR
        ) {
          found.push({ kind: 'payout_stuck', ...base });
        }
      }
    }

    // ── Выплаты по «Безопасной сделке» ──
    if (process.env.PAYMENT_PROVIDER === 'yookassa') {
      const rows = await this.prisma.dealPayout.findMany({
        where: {
          externalId: { not: null },
          OR: [{ updatedAt: { gte: from, lt: to }, status: 'paid' }, { status: 'sent' }],
        },
        orderBy: { updatedAt: 'desc' },
        take: PAYOUT_CAP,
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          externalId: true,
          updatedAt: true,
        },
      });
      for (const d of rows) {
        checked.dealPayouts++;
        const r = await this.deals.payoutStatus(d.externalId!);
        const ours = { id: d.id, status: d.status, amount: money(d.amount), currency: d.currency };
        const theirs = { id: r.externalId, status: r.status, amount: money(r.amount) };
        const base = {
          entity: 'deal_payout' as const,
          ref: d.id,
          ourId: d.id,
          externalId: d.externalId,
          ours,
          theirs,
        };
        if (
          d.status === 'paid' &&
          (r.status === 'failed' || (r.amount !== undefined && r.amount !== d.amount))
        ) {
          found.push({ kind: 'payout_mismatch', ...base });
        } else if (
          d.status === 'sent' &&
          r.status !== 'pending' &&
          now.getTime() - d.updatedAt.getTime() > HOUR
        ) {
          found.push({ kind: 'payout_stuck', ...base });
        }
      }
    }
    return { found, checked, skipped: null, partial };
  }

  /** Для консоли: последние прогоны и открытые расхождения (или закрытые). */
  async overview(opts: { resolved?: boolean } = {}) {
    const [runs, issues, open] = await Promise.all([
      this.prisma.reconciliationRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
      this.prisma.reconciliationIssue.findMany({
        where: { resolvedAt: opts.resolved ? { not: null } : null },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.reconciliationIssue.count({ where: { resolvedAt: null } }),
    ]);
    const staff = new Map(
      (
        await this.prisma.profile.findMany({
          where: {
            userId: {
              in: [
                ...new Set(
                  [...runs.map((r) => r.startedBy), ...issues.map((i) => i.resolvedBy)].filter(
                    (v): v is string => !!v,
                  ),
                ),
              ],
            },
          },
          select: { userId: true, username: true },
        })
      ).map((p) => [p.userId, p.username]),
    );
    return {
      autoEveryHours: EVERY_H,
      runs: runs.map((r) => ({
        ...r,
        startedBy: r.startedBy ? (staff.get(r.startedBy) ?? null) : null,
      })),
      open,
      issues: issues.map((i) => ({
        ...i,
        text: ISSUE_TEXT[i.kind as IssueKind] ?? i.kind,
        resolvedBy: i.resolvedBy ? (staff.get(i.resolvedBy) ?? null) : null,
      })),
    };
  }

  /** Закрыть расхождение: сотрудник разобрался и пишет, что было. В журнал. */
  async resolve(id: string, actorId: string, note: string) {
    const issue = await this.prisma.reconciliationIssue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException('Расхождение не найдено');
    if (issue.resolvedAt) throw new BadRequestException('Расхождение уже закрыто');
    const done = await this.prisma.reconciliationIssue.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedBy: actorId, note },
    });
    await this.audit.log({
      actorId,
      action: 'reconcile.resolve',
      entityType: 'reconciliation_issue',
      entityId: id,
      after: { kind: issue.kind, ref: issue.ref, note },
    });
    return done;
  }
}
