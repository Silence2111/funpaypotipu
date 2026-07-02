import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type OrderStatus } from '@gamemarket/db';
import {
  canTransition,
  payToEscrowFromGateway,
  refundToBalance,
  releaseEscrow,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { LedgerService } from '../ledger/ledger.service';
import { FeesService } from './fees.service';

const AUTO_CONFIRM_TTL_MS = 72 * 3600 * 1000; // 72ч (docs/03)

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly fees: FeesService,
  ) {}

  async create(buyerId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status !== 'active') throw new NotFoundException('Лот недоступен');
    if (listing.sellerId === buyerId) throw new BadRequestException('Нельзя купить собственный лот');

    const base = listing.price;
    const f = await this.fees.computeForCategory(base, listing.categoryId, listing.currency);

    return this.prisma.order.create({
      data: {
        publicNumber: `GM-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4)}`,
        buyerId,
        sellerId: listing.sellerId,
        listingId,
        listingSnapshot: {
          title: listing.title,
          basePrice: base.toString(),
          currency: listing.currency,
        } as Prisma.InputJsonValue,
        qty: 1,
        amount: f.amountToPay,
        currency: listing.currency,
        feeBuyer: f.feeBuyer,
        feeSeller: f.feeSeller,
        sellerPayoutAmount: f.sellerPayout,
        status: 'created',
        fulfillmentType: listing.fulfillmentType,
        conversation: { create: { buyerId, sellerId: listing.sellerId } },
      },
    });
  }

  /** Оплата подтверждена (вызывается из payments после вебхука). Идемпотентно. */
  async markPaid(orderId: string) {
    const order = await this.get(orderId);
    if (order.status === 'paid') return order;
    this.assertTransition(order.status, 'paid');

    await this.ledger.post({
      legs: payToEscrowFromGateway(order.amount),
      currency: order.currency,
      idempotencyKey: `pay:${order.id}`,
      orderId: order.id,
      refType: 'order_payment',
      refId: order.id,
    });

    return this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'paid', paidAt: new Date() },
    });
  }

  async markDelivered(orderId: string, sellerId: string) {
    const order = await this.get(orderId);
    if (order.sellerId !== sellerId) throw new ForbiddenException('Это не ваш заказ');
    this.assertTransition(order.status, 'delivered');

    await this.prisma.delivery.upsert({
      where: { orderId: order.id },
      update: { status: 'sent', deliveredAt: new Date() },
      create: {
        orderId: order.id,
        method: order.fulfillmentType,
        status: 'sent',
        deliveredAt: new Date(),
      },
    });

    return this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'delivered',
        deliveredAt: new Date(),
        autoConfirmAt: new Date(Date.now() + AUTO_CONFIRM_TTL_MS),
      },
    });
  }

  /** Покупатель подтверждает получение (или система по таймауту). Релиз эскроу. */
  async confirm(orderId: string, buyerId: string, opts: { system?: boolean } = {}) {
    const order = await this.get(orderId);
    if (!opts.system && order.buyerId !== buyerId) throw new ForbiddenException('Это не ваш заказ');
    this.assertTransition(order.status, 'completed');

    const revenue = order.amount - order.sellerPayoutAmount;
    await this.ledger.post({
      legs: releaseEscrow(order.sellerId, order.sellerPayoutAmount, revenue),
      currency: order.currency,
      idempotencyKey: `release:${order.id}`,
      orderId: order.id,
      refType: 'order_release',
      refId: order.id,
    });

    const [updated] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'completed', completedAt: new Date() },
      }),
      this.prisma.listing.update({
        where: { id: order.listingId },
        data: { salesCount: { increment: 1 } },
      }),
      this.prisma.profile.update({
        where: { userId: order.sellerId },
        data: { salesCount: { increment: 1 } },
      }),
    ]);
    return updated;
  }

  /** Отмена: до оплаты — просто отмена; после оплаты — возврат на баланс покупателя. */
  async cancel(orderId: string, userId: string) {
    const order = await this.get(orderId);
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('Нет доступа к заказу');
    }

    if (order.status === 'created') {
      this.assertTransition(order.status, 'cancelled');
      return this.prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
    }

    if (order.status === 'paid') {
      this.assertTransition(order.status, 'refunded');
      await this.ledger.post({
        legs: refundToBalance(order.buyerId, order.amount),
        currency: order.currency,
        idempotencyKey: `refund:${order.id}`,
        orderId: order.id,
        refType: 'order_refund',
        refId: order.id,
      });
      return this.prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });
    }

    throw new ConflictException(`Нельзя отменить заказ в статусе ${order.status}`);
  }

  listMine(userId: string) {
    return this.prisma.order.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getForUser(orderId: string, userId: string) {
    const order = await this.get(orderId);
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('Нет доступа к заказу');
    }
    return order;
  }

  private async get(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  private assertTransition(from: OrderStatus, to: OrderStatus) {
    if (!canTransition(from, to)) {
      throw new ConflictException(`Недопустимый переход ${from} → ${to}`);
    }
  }
}
