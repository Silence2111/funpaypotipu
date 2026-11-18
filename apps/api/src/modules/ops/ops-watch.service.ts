import { Inject, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { OpsAlertService } from './ops-alert.service';
import { ErrorMonitorService } from './error-monitor.service';

const MIN = 60_000;
const WATCH_MS = Number(process.env.OPS_WATCH_MS ?? MIN);

/** Пороги тревог; меняются окружением, по умолчанию — разумные для запуска. */
export const thresholds = () => ({
  /** Ошибок API за 5 минут — всплеск. */
  errorSpike: Number(process.env.OPS_ERROR_SPIKE ?? 20),
  /** Неудачных оплат подряд (за последние 2 часа) — шлюз или способ оплаты сломались. */
  failedPayments: Number(process.env.OPS_FAILED_PAYMENTS ?? 5),
  /** Отказов вебхуков за 15 минут. */
  webhookFailures: Number(process.env.OPS_WEBHOOK_FAILURES ?? 3),
  /** Выплата «отправляется» дольше стольких часов — зависла. */
  payoutStuckHours: Number(process.env.OPS_PAYOUT_STUCK_HOURS ?? 2),
});

export interface OpsState {
  errors5m: number;
  topError: string | null;
  failedInRow: number;
  webhookFailures15m: number;
  stuckPayouts: number;
  stuckDealPayouts: number;
}

/**
 * Правила тревог (часть 130), раз в минуту: всплеск ошибок API, оплаты,
 * которые не проходят подряд, отказы вебхуков ЮKassa и выплаты, зависшие в
 * «Отправляются». Сработало — тревога в Telegram (не чаще раза в полчаса на
 * правило, зависшие выплаты — раз в 6 ч). Сигналы старше недели удаляются.
 */
@Injectable()
export class OpsWatchService {
  private lastCleanup = 0;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly alerts: OpsAlertService,
    private readonly errors: ErrorMonitorService,
  ) {}

  @Interval('ops-watch', WATCH_MS)
  async tick() {
    await this.errors.flush();
    await this.check();
  }

  /** Текущее состояние по всем правилам — и для консоли, и для тревог. */
  async state(now = new Date()): Promise<OpsState> {
    const t = thresholds();
    const [errors5m, top, recentPayments, webhookFailures15m, stuckPayouts, stuckDealPayouts] =
      await Promise.all([
        this.prisma.opsEvent.count({
          where: { kind: 'error', at: { gt: new Date(now.getTime() - 5 * MIN) } },
        }),
        this.prisma.errorGroup.findFirst({
          where: { source: 'api', lastSeenAt: { gt: new Date(now.getTime() - 5 * MIN) } },
          orderBy: { count: 'desc' },
          select: { message: true },
        }),
        // Только оплаты через шлюз: заглушка в бою не работает, баланс — не шлюз.
        this.prisma.payment.findMany({
          where: {
            provider: { not: 'balance' },
            createdAt: { gt: new Date(now.getTime() - 120 * MIN) },
            status: { in: ['succeeded', 'failed', 'refunded'] },
          },
          orderBy: { updatedAt: 'desc' },
          take: t.failedPayments,
          select: { status: true },
        }),
        this.prisma.opsEvent.count({
          where: { kind: 'webhook_failed', at: { gt: new Date(now.getTime() - 15 * MIN) } },
        }),
        this.prisma.payout.count({
          where: {
            status: 'processing',
            updatedAt: { lt: new Date(now.getTime() - t.payoutStuckHours * 60 * MIN) },
          },
        }),
        this.prisma.dealPayout.count({
          where: {
            status: 'sent',
            updatedAt: { lt: new Date(now.getTime() - t.payoutStuckHours * 60 * MIN) },
          },
        }),
      ]);
    let failedInRow = 0;
    for (const p of recentPayments) {
      if (p.status !== 'failed') break;
      failedInRow++;
    }
    return {
      errors5m,
      topError: top?.message ?? null,
      failedInRow,
      webhookFailures15m,
      stuckPayouts,
      stuckDealPayouts,
    };
  }

  async check(now = new Date()) {
    const t = thresholds();
    const s = await this.state(now);
    const fired: string[] = [];
    if (s.errors5m >= t.errorSpike) {
      const top = s.topError ? ` Чаще всего: «${s.topError.slice(0, 160)}».` : '';
      if (await this.alerts.alert('errors', `за 5 минут — ${s.errors5m} ошибок API.${top}`, now))
        fired.push('errors');
    }
    if (s.failedInRow >= t.failedPayments) {
      if (
        await this.alerts.alert(
          'payments',
          `${s.failedInRow} оплат подряд не прошли — проверьте шлюз и способы оплаты.`,
          now,
        )
      )
        fired.push('payments');
    }
    if (s.webhookFailures15m >= t.webhookFailures) {
      if (
        await this.alerts.alert(
          'webhooks',
          `за 15 минут — ${s.webhookFailures15m} отказов вебхуков: шлюз не может провести оплаты или выплаты.`,
          now,
        )
      )
        fired.push('webhooks');
    }
    const stuck = s.stuckPayouts + s.stuckDealPayouts;
    if (stuck > 0) {
      if (
        await this.alerts.alert(
          'payouts',
          `${stuck} выплат «отправляются» дольше ${t.payoutStuckHours} ч — проверьте их у ЮKassa.`,
          now,
        )
      )
        fired.push('payouts');
    }
    if (now.getTime() - this.lastCleanup > 60 * MIN) {
      this.lastCleanup = now.getTime();
      await this.prisma.opsEvent.deleteMany({
        where: { at: { lt: new Date(now.getTime() - 7 * 24 * 60 * MIN) } },
      });
    }
    return { state: s, fired };
  }
}
