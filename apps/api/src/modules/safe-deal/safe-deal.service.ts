import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaClient, type Order } from '@gamemarket/db';
import {
  PAYMENT_SCHEME_KEY,
  releaseEscrowToDeal,
  refundToGateway,
  SAFE_DEAL_PAY_METHODS,
  SAFE_DEAL_PAYOUT_MAX,
  safeDealReward,
  settlePayout,
  type PaymentScheme,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { LedgerService } from '../ledger/ledger.service';
import { EncryptionService } from '../crypto/encryption.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../access/audit.service';
import { MockDealGateway, YooKassaDealGateway, type DealDestination, type DealGateway, type DealPayoutResult } from './deal.gateway';

/** Проход выплат по сделкам: повтор ждущих и опрос отправленных; в e2e — 2 с. */
const SWEEP_MS = Number(process.env.SAFE_DEAL_SWEEP_MS ?? 60_000);

type DealPayoutRow = {
  id: string;
  orderId: string;
  sellerId: string;
  dealId: string;
  amount: bigint;
  currency: string;
  status: string;
  externalId: string | null;
  failureReason: string | null;
  destinationId: string | null;
  updatedAt: Date;
};

/**
 * «Безопасная сделка» ЮKassa (часть 123). Схема выбирается в консоли
 * (`system_settings.payment_scheme`): escrow — деньги на счёте площадки,
 * как было; safe_deal — у ЮKassa на сделке. Заказ, оплаченный в сделке,
 * помнит её (`orders.deal_id`), и всё дальше идёт через неё, даже если
 * схему потом переключат:
 * - оплата — только картой (СБП ЮKassa в сделке не принимает), с баланса и
 *   пополнение баланса — нельзя: деньги площадки в сделку не попадают;
 * - завершение — доля продавца не на его баланс, а выплатой по сделке на
 *   карту или ЮMoney (`deal_payouts`); нет реквизитов или отказ — выплата
 *   ждёт, продавцу уведомление, проход повторяет её, когда реквизиты
 *   появятся;
 * - возврат — на карту покупателя, не на баланс.
 */
@Injectable()
export class SafeDealService {
  private readonly logger = new Logger(SafeDealService.name);
  private sweeping = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly encryption: EncryptionService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly mock: MockDealGateway,
    private readonly yookassa: YooKassaDealGateway,
  ) {}

  private get gateway(): DealGateway {
    const live = process.env.PAYMENT_PROVIDER === 'yookassa' && !!process.env.YOOKASSA_SHOP_ID && !!process.env.YOOKASSA_SECRET_KEY;
    return live ? this.yookassa : this.mock;
  }

  async scheme(): Promise<PaymentScheme> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: PAYMENT_SCHEME_KEY } });
    return (row?.value as { scheme?: PaymentScheme } | null)?.scheme === 'safe_deal' ? 'safe_deal' : 'escrow';
  }

  async setScheme(actorId: string, scheme: PaymentScheme) {
    const before = await this.scheme();
    await this.prisma.systemSetting.upsert({
      where: { key: PAYMENT_SCHEME_KEY },
      create: { key: PAYMENT_SCHEME_KEY, value: { scheme } },
      update: { value: { scheme } },
    });
    if (before !== scheme) {
      await this.audit.log({
        actorId,
        action: 'settings.payment_scheme',
        entityType: 'setting',
        entityId: PAYMENT_SCHEME_KEY,
        before: { scheme: before },
        after: { scheme },
      });
    }
    return { scheme };
  }

  /** Способ оплаты подходит сделке? Иначе — 400 с объяснением. */
  assertMethod(method: string) {
    if (!(SAFE_DEAL_PAY_METHODS as readonly string[]).includes(method)) {
      throw new BadRequestException('В «Безопасной сделке» оплата — только картой: СБП ЮKassa в сделке не принимает');
    }
  }

  /** Открыть сделку у ЮKassa для заказа (один раз): вернуть её id. */
  async ensureDeal(order: Pick<Order, 'id' | 'publicNumber' | 'amount' | 'sellerPayoutAmount' | 'dealId'>): Promise<string> {
    if (order.dealId) return order.dealId;
    if (safeDealReward(order.amount, order.sellerPayoutAmount) <= 0n) {
      throw new BadRequestException('Этот заказ нельзя оплатить в «Безопасной сделке»: у площадки не остаётся вознаграждения');
    }
    const dealId = await this.gateway.createDeal({ orderId: order.id, description: `Заказ ${order.publicNumber}` });
    // Условно: два одновременных платежа не откроют две сделки на заказ.
    await this.prisma.order.updateMany({ where: { id: order.id, dealId: null }, data: { dealId } });
    const fresh = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { dealId: true } });
    return fresh.dealId!;
  }

  /**
   * Завершение сделки: доля продавца — в обязательство к выплате по
   * сделке, вознаграждение — в доход; выплата уходит сразу, если есть куда.
   */
  async release(order: Order, refType: string) {
    const revenue = order.amount - order.sellerPayoutAmount;
    await this.ledger.post({
      legs: releaseEscrowToDeal(order.sellerPayoutAmount, revenue),
      currency: order.currency,
      // Тот же ключ, что у обычного завершения: дважды не проведётся ни так, ни так.
      idempotencyKey: `release:${order.id}`,
      orderId: order.id,
      refType,
      refId: order.id,
    });
    const dp = await this.prisma.dealPayout.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        sellerId: order.sellerId,
        dealId: order.dealId!,
        amount: order.sellerPayoutAmount,
        currency: order.currency,
      },
      update: {},
    });
    await this.send(dp, true);
  }

  /** Возврат покупателю на карту: платёж целиком, сделка закрывается. */
  async refund(order: Order, refType: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId: order.id, status: 'succeeded' },
      orderBy: { createdAt: 'desc' },
      select: { providerRef: true, externalId: true, amount: true },
    });
    await this.gateway.refund({
      paymentId: payment?.externalId ?? payment?.providerRef ?? order.id,
      amount: payment?.amount ?? order.amount,
      currency: order.currency,
      idempotenceKey: `refund-${order.id}`,
    });
    await this.ledger.post({
      legs: refundToGateway(order.amount),
      currency: order.currency,
      idempotencyKey: `refund:${order.id}`,
      orderId: order.id,
      refType,
      refId: order.id,
    });
  }

  /** Реквизиты продавца для выплаты по сделке: последние карта из виджета или ЮMoney. */
  private async destination(sellerId: string): Promise<{ id: string; dest: DealDestination; at: Date } | null> {
    const rows = await this.prisma.payoutDestination.findMany({
      where: { userId: sellerId, method: { in: ['card', 'yoomoney'] } },
      orderBy: { lastUsedAt: 'desc' },
      take: 5,
    });
    for (const r of rows) {
      let raw: string;
      try {
        raw = this.encryption.decrypt(r.destinationEnc);
      } catch {
        continue;
      }
      if (r.method === 'yoomoney' && /^\d{11,20}$/.test(raw)) {
        return { id: r.id, dest: { method: 'yoomoney', account: raw }, at: r.lastUsedAt };
      }
      if (r.method === 'card') {
        try {
          const token = (JSON.parse(raw) as { token?: string }).token;
          if (token) return { id: r.id, dest: { method: 'card', token }, at: r.lastUsedAt };
        } catch {
          // номер карты без токена ЮKassa по сделке не выплатить
        }
      }
    }
    return null;
  }

  /** Отправить выплату по сделке или оставить ждать — с уведомлением продавцу один раз. */
  private async send(dp: DealPayoutRow, first = false) {
    if (dp.status === 'paid' || dp.status === 'sent') return;
    const to = await this.destination(dp.sellerId);
    if (!to) {
      if (first || dp.failureReason !== 'no_destination') {
        await this.prisma.dealPayout.update({ where: { id: dp.id }, data: { status: 'waiting', failureReason: 'no_destination' } });
        await this.notifications.notify(dp.sellerId, 'deal_payout_waiting', { orderId: dp.orderId, amount: dp.amount.toString() });
      }
      return;
    }
    // Отказ по этим же реквизитам не повторяем: ждём новые.
    if (dp.status === 'failed' && dp.destinationId === to.id && to.at <= dp.updatedAt) return;
    if (dp.amount > SAFE_DEAL_PAYOUT_MAX && to.dest.method === 'card') {
      await this.prisma.dealPayout.update({ where: { id: dp.id }, data: { status: 'failed', failureReason: 'one_time_limit_exceeded', destinationId: to.id } });
      return;
    }
    let res: DealPayoutResult;
    try {
      res = await this.gateway.payout({
        dealId: dp.dealId,
        amount: dp.amount,
        currency: dp.currency,
        destination: to.dest,
        description: `Выплата по сделке ${dp.orderId.slice(0, 8)}`,
        idempotenceKey: `deal-payout-${dp.id}-${to.id}`,
      });
    } catch (e) {
      this.logger.warn(`Выплата по сделке ${dp.id}: ${(e as Error).message}`);
      return;
    }
    await this.apply(dp, res, to.dest.method, to.id);
  }

  private async apply(dp: DealPayoutRow, res: DealPayoutResult, method?: string, destinationId?: string) {
    if (res.status === 'paid') {
      await this.ledger.post({
        legs: settlePayout(dp.amount, 0n),
        currency: dp.currency,
        idempotencyKey: `deal_payout:${dp.id}`,
        orderId: dp.orderId,
        refType: 'deal_payout',
        refId: dp.id,
      });
      await this.prisma.dealPayout.update({
        where: { id: dp.id },
        data: { status: 'paid', paidAt: new Date(), externalId: res.externalId, failureReason: null, ...(method ? { method } : {}), ...(destinationId ? { destinationId } : {}) },
      });
      await this.notifications.notify(dp.sellerId, 'payout_paid', { orderId: dp.orderId, amount: dp.amount.toString() });
      return;
    }
    if (res.status === 'pending') {
      await this.prisma.dealPayout.update({
        where: { id: dp.id },
        data: { status: 'sent', externalId: res.externalId, ...(method ? { method } : {}), ...(destinationId ? { destinationId } : {}) },
      });
      return;
    }
    await this.prisma.dealPayout.update({
      where: { id: dp.id },
      data: { status: 'failed', externalId: res.externalId, failureReason: res.reason ?? 'canceled', ...(method ? { method } : {}), ...(destinationId ? { destinationId } : {}) },
    });
    await this.notifications.notify(dp.sellerId, 'deal_payout_waiting', {
      orderId: dp.orderId,
      amount: dp.amount.toString(),
      reason: res.reason ?? 'canceled',
    });
  }

  /** Повтор ждущих и упавших (когда появились новые реквизиты), опрос отправленных. */
  @Interval('safe-deal-payouts', SWEEP_MS)
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const rows = await this.prisma.dealPayout.findMany({
        where: { status: { in: ['waiting', 'failed', 'sent'] } },
        orderBy: { updatedAt: 'asc' },
        take: 100,
      });
      for (const dp of rows) {
        if (dp.status === 'sent' && dp.externalId) {
          const res = await this.gateway.payoutStatus(dp.externalId);
          if (res.status !== 'pending') await this.apply(dp, res);
        } else {
          await this.send(dp);
        }
      }
    } catch (e) {
      this.logger.error(`Выплаты по сделкам: ${(e as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }
}
