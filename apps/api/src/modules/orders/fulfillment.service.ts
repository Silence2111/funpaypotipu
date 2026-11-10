import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient, type Order } from '@gamemarket/db';
import { refundToBalance } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MockTopUpProvider, type TopUpResult } from './topup.provider';

/** Ключи и пополнения подтверждаются быстрее: проверить их — дело минут. */
export const AUTO_GOODS_CONFIRM_MS = 24 * 3600 * 1000;

/** Авто-исполнение заказа после оплаты: выдача ключа из склада или пополнение. */
@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly topup: MockTopUpProvider,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  async autoFulfill(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== 'paid') return;
    if (order.fulfillmentType === 'auto_key') await this.deliverKey(order);
    else if (order.fulfillmentType === 'provider') await this.deliverTopUp(order);
  }

  private async deliverKey(order: Order): Promise<void> {
    const goodIds = await this.reserveGoods(order.listingId, order.id, order.qty);
    if (!goodIds) {
      // Нет в наличии — авто-возврат покупателю на баланс, чтобы деньги не зависли в эскроу.
      await this.refundToBuyer(order, 'oos_refund', 'out_of_stock');
      await this.notifications.notify(order.sellerId, 'listing_out_of_stock', {
        orderId: order.id,
        listingId: order.listingId,
      });
      return;
    }

    const autoConfirmAt = new Date(Date.now() + AUTO_GOODS_CONFIRM_MS);
    await this.prisma.$transaction([
      this.prisma.delivery.upsert({
        where: { orderId: order.id },
        update: { status: 'sent', deliveredAt: new Date(), payloadRef: { goodIds } },
        create: {
          orderId: order.id,
          method: 'auto_key',
          status: 'sent',
          deliveredAt: new Date(),
          payloadRef: { goodIds },
        },
      }),
      ...goodIds.map((id) =>
        this.prisma.digitalGood.update({
          where: { id },
          data: { status: 'delivered', deliveredAt: new Date() },
        }),
      ),
      this.prisma.listing.update({
        where: { id: order.listingId },
        data: { stock: { decrement: goodIds.length } },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'delivered', deliveredAt: new Date(), autoConfirmAt },
      }),
    ]);
    // Ключи кончились — лот уходит из каталога сам и вернётся с пополнением склада.
    await this.prisma.listing.updateMany({
      where: { id: order.listingId, stock: { lte: 0 }, status: 'active' },
      data: { status: 'sold_out' },
    });
  }

  /**
   * Резерв `qty` ключей под заказ. Не хватило — резерв снимается целиком, и
   * заказ уходит в возврат: полвыдачи за полную цену хуже, чем возврат.
   * Повторный вызов по тому же заказу берёт уже зарезервированные ключи.
   */
  private async reserveGoods(listingId: string, orderId: string, qty: number): Promise<string[] | null> {
    const held = await this.prisma.digitalGood.findMany({
      where: { reservedForOrderId: orderId, status: 'reserved' },
      select: { id: true },
    });
    const ids = held.map((g) => g.id);
    while (ids.length < qty) {
      const id = await this.reserveGood(listingId, orderId);
      if (!id) break;
      ids.push(id);
    }
    if (ids.length < qty) {
      if (ids.length) {
        await this.prisma.digitalGood.updateMany({
          where: { id: { in: ids }, status: 'reserved' },
          data: { status: 'available', reservedForOrderId: null },
        });
      }
      return null;
    }
    return ids;
  }

  private async deliverTopUp(order: Order): Promise<void> {
    const snapshot = order.listingSnapshot as { account?: string; topupAmount?: string } | null;
    // Провайдер зачисляет номинал, а не сумму оплаты: в сумме оплаты наценка
    // продавца, а промокод её уменьшает. У лота «на сумму покупателя» номинал
    // записан в заказе; у лотов с фиксированной ценой его нет — им, как и
    // раньше, уходит сумма заказа.
    const amount = snapshot?.topupAmount ? BigInt(snapshot.topupAmount) : order.amount;

    let res: TopUpResult;
    try {
      res = await this.topup.topUp({
        orderId: order.id,
        amount,
        currency: order.currency,
        account: snapshot?.account,
      });
    } catch (e) {
      // Исход неизвестен: провайдер мог и зачислить. Вернуть деньги вслепую —
      // значит отдать и пополнение, и деньги. Заказ остаётся «оплачен» до
      // выяснения, а подтверждение оплаты не падает вместе с провайдером.
      this.logger.error(`Пополнение по заказу ${order.id}: провайдер не ответил — ${(e as Error).message}`);
      return;
    }
    if (!res.ok) {
      // Провайдер отказал (нет такого аккаунта, не тот регион) — денег он не
      // взял, держать их в эскроу незачем. Раньше заказ оставался «оплачен»
      // навсегда: авто-возврат по таймеру касается только ручной выдачи.
      await this.refundToBuyer(order, 'topup_rejected_refund', 'topup_rejected');
      await this.notifications.notify(order.sellerId, 'order_cancelled', {
        orderId: order.id,
        reason: 'topup_rejected',
      });
      return;
    }

    const autoConfirmAt = new Date(Date.now() + AUTO_GOODS_CONFIRM_MS);
    await this.prisma.$transaction([
      this.prisma.delivery.upsert({
        where: { orderId: order.id },
        update: { status: 'sent', deliveredAt: new Date(), providerRef: res.providerRef },
        create: {
          orderId: order.id,
          method: 'provider',
          status: 'sent',
          deliveredAt: new Date(),
          providerRef: res.providerRef,
        },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'delivered', deliveredAt: new Date(), autoConfirmAt },
      }),
    ]);
  }

  /** Возврат всей суммы заказа на баланс покупателя. Идемпотентен по ключу заказа. */
  private async refundToBuyer(order: Order, refType: string, reason: string): Promise<void> {
    await this.ledger.post({
      legs: refundToBalance(order.buyerId, order.amount),
      currency: order.currency,
      idempotencyKey: `refund:${order.id}`,
      orderId: order.id,
      refType,
      refId: order.id,
    });
    await this.prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });
    await this.notifications.notify(order.buyerId, 'order_refunded', { orderId: order.id, reason });
  }

  /** Compare-and-set резерв одного доступного ключа (защита от двойной выдачи). */
  private async reserveGood(listingId: string, orderId: string): Promise<string | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = await this.prisma.digitalGood.findFirst({
        where: { listingId, status: 'available' },
        select: { id: true },
      });
      if (!candidate) return null;
      const res = await this.prisma.digitalGood.updateMany({
        where: { id: candidate.id, status: 'available' },
        data: { status: 'reserved', reservedForOrderId: orderId },
      });
      if (res.count === 1) return candidate.id;
    }
    return null;
  }
}
