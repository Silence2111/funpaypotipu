import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient, type Order } from '@gamemarket/db';
import { refundToBalance } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MockTopUpProvider } from './topup.provider';

const AUTO_CONFIRM_TTL_MS = 24 * 3600 * 1000; // авто-товары подтверждаются быстрее

/** Авто-исполнение заказа после оплаты: выдача ключа из склада или пополнение. */
@Injectable()
export class FulfillmentService {
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
    const goodId = await this.reserveGood(order.listingId, order.id);
    if (!goodId) {
      // Нет в наличии — авто-возврат покупателю на баланс, чтобы деньги не зависли в эскроу.
      await this.ledger.post({
        legs: refundToBalance(order.buyerId, order.amount),
        currency: order.currency,
        idempotencyKey: `refund:${order.id}`,
        orderId: order.id,
        refType: 'oos_refund',
        refId: order.id,
      });
      await this.prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });
      await this.notifications.notify(order.buyerId, 'order_refunded', {
        orderId: order.id,
        reason: 'out_of_stock',
      });
      await this.notifications.notify(order.sellerId, 'listing_out_of_stock', {
        orderId: order.id,
        listingId: order.listingId,
      });
      return;
    }

    const autoConfirmAt = new Date(Date.now() + AUTO_CONFIRM_TTL_MS);
    await this.prisma.$transaction([
      this.prisma.delivery.upsert({
        where: { orderId: order.id },
        update: { status: 'sent', deliveredAt: new Date(), payloadRef: { goodId } },
        create: {
          orderId: order.id,
          method: 'auto_key',
          status: 'sent',
          deliveredAt: new Date(),
          payloadRef: { goodId },
        },
      }),
      this.prisma.digitalGood.update({
        where: { id: goodId },
        data: { status: 'delivered', deliveredAt: new Date() },
      }),
      this.prisma.listing.update({
        where: { id: order.listingId },
        data: { stock: { decrement: 1 } },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'delivered', deliveredAt: new Date(), autoConfirmAt },
      }),
    ]);
  }

  private async deliverTopUp(order: Order): Promise<void> {
    const res = await this.topup.topUp({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });
    if (!res.ok) return;

    const autoConfirmAt = new Date(Date.now() + AUTO_CONFIRM_TTL_MS);
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
