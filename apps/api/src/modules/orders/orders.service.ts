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
  payToEscrowFromBalance,
  payToEscrowFromGateway,
  refundToBalance,
  releaseEscrow,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { LedgerService } from '../ledger/ledger.service';
import { EncryptionService } from '../crypto/encryption.service';
import { PromoService } from '../promo/promo.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FeesService } from './fees.service';
import { FulfillmentService } from './fulfillment.service';

const AUTO_CONFIRM_TTL_MS = Number(process.env.ORDER_AUTO_CONFIRM_TTL_MS ?? 72 * 3600 * 1000); // docs/03

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly fees: FeesService,
    private readonly fulfillment: FulfillmentService,
    private readonly encryption: EncryptionService,
    private readonly promo: PromoService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(buyerId: string, listingId: string, promoCode?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status !== 'active') throw new NotFoundException('Лот недоступен');
    if (listing.sellerId === buyerId) throw new BadRequestException('Нельзя купить собственный лот');

    const base = listing.price;
    const f = await this.fees.computeForCategory(
      base,
      listing.categoryId,
      listing.currency,
      listing.sellerId,
    );

    // Промокод: скидка снимается с комиссии площадки (не с выплаты продавцу).
    let amount = f.amountToPay;
    if (promoCode) {
      const maxDiscount = f.amountToPay - f.sellerPayout; // = комиссия площадки
      amount -= await this.promo.consume(promoCode, f.amountToPay, maxDiscount);
    }

    const order = await this.prisma.order.create({
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
        amount,
        currency: listing.currency,
        feeBuyer: f.feeBuyer,
        feeSeller: f.feeSeller,
        sellerPayoutAmount: f.sellerPayout,
        status: 'created',
        fulfillmentType: listing.fulfillmentType,
        conversation: { create: { buyerId, sellerId: listing.sellerId } },
      },
    });
    await this.notifications.notify(listing.sellerId, 'order_created', {
      orderId: order.id,
      title: listing.title,
    });
    return order;
  }

  /** Оплата подтверждена провайдером (вызывается из payments после вебхука). Идемпотентно. */
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
    return this.finalizePaid(order.id);
  }

  /** Оплата заказа с баланса пользователя (без внешнего провайдера). */
  async payFromBalance(orderId: string, buyerId: string) {
    const order = await this.get(orderId);
    if (order.buyerId !== buyerId) throw new ForbiddenException('Это не ваш заказ');
    if (order.status === 'paid') return order;
    this.assertTransition(order.status, 'paid');

    const balance = await this.ledger.balanceOf(buyerId, order.currency);
    if (balance < order.amount) throw new BadRequestException('Недостаточно средств на балансе');

    await this.ledger.post({
      legs: payToEscrowFromBalance(buyerId, order.amount),
      currency: order.currency,
      idempotencyKey: `pay:${order.id}`,
      orderId: order.id,
      refType: 'order_payment_balance',
      refId: order.id,
    });
    return this.finalizePaid(order.id);
  }

  /** Общий пост-оплатный шаг: статус paid → уведомления → авто-исполнение. */
  private async finalizePaid(orderId: string) {
    const paid = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'paid', paidAt: new Date() },
    });
    await this.notifications.notify(paid.sellerId, 'order_paid', { orderId: paid.id });

    if (paid.fulfillmentType !== 'manual') {
      await this.fulfillment.autoFulfill(paid.id);
      const fulfilled = await this.get(paid.id);
      if (fulfilled.status === 'delivered') {
        await this.notifications.notify(fulfilled.buyerId, 'order_delivered', { orderId: fulfilled.id });
      }
      return fulfilled;
    }
    return paid;
  }

  /** Покупатель получает выданный ключ (расшифровка). */
  async revealKey(orderId: string, buyerId: string) {
    const order = await this.get(orderId);
    if (order.buyerId !== buyerId) throw new ForbiddenException('Это не ваш заказ');
    if (order.status !== 'delivered' && order.status !== 'completed') {
      throw new BadRequestException('Товар ещё не выдан');
    }
    const delivery = await this.prisma.delivery.findUnique({ where: { orderId } });
    const goodId = (delivery?.payloadRef as { goodId?: string } | null)?.goodId;
    if (!goodId) throw new NotFoundException('Для этого заказа нет авто-выданного ключа');
    const good = await this.prisma.digitalGood.findUnique({ where: { id: goodId } });
    if (!good) throw new NotFoundException('Ключ не найден');
    return { key: this.encryption.decrypt(good.payloadEnc) };
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

    // Холд короче для доверенных продавцов (уровень) — быстрее выплата.
    const level = await this.fees.levelOf(order.sellerId);
    const holdMs = Math.min(level.holdHours * 3600 * 1000, AUTO_CONFIRM_TTL_MS);
    const delivered = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'delivered',
        deliveredAt: new Date(),
        autoConfirmAt: new Date(Date.now() + holdMs),
      },
    });
    await this.notifications.notify(delivered.buyerId, 'order_delivered', { orderId: delivered.id });
    return delivered;
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
    await this.notifications.notify(order.sellerId, 'order_completed', { orderId: order.id });
    return updated;
  }

  /** Отмена: до оплаты — просто отмена; после оплаты — возврат на баланс покупателя. */
  async cancel(orderId: string, userId: string) {
    const order = await this.get(orderId);
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('Нет доступа к заказу');
    }

    const counterparty = order.buyerId === userId ? order.sellerId : order.buyerId;

    if (order.status === 'created') {
      this.assertTransition(order.status, 'cancelled');
      const res = await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'cancelled' },
      });
      await this.notifications.notify(counterparty, 'order_cancelled', { orderId: order.id });
      return res;
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
      const res = await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'refunded' },
      });
      await this.notifications.notify(order.buyerId, 'order_refunded', { orderId: order.id });
      return res;
    }

    throw new ConflictException(`Нельзя отменить заказ в статусе ${order.status}`);
  }

  /** Перевод заказа в спор (вызывается disputes-модулем). */
  async markDisputed(orderId: string, userId: string) {
    const order = await this.get(orderId);
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('Нет доступа к заказу');
    }
    this.assertTransition(order.status, 'disputed');
    return this.prisma.order.update({ where: { id: order.id }, data: { status: 'disputed' } });
  }

  /** Разрешение спора арбитром: релиз продавцу или возврат покупателю. Идемпотентно. */
  async applyDisputeResolution(orderId: string, outcome: 'seller' | 'buyer') {
    const order = await this.get(orderId);
    if (order.status !== 'disputed') {
      throw new ConflictException('Заказ не в статусе спора');
    }

    if (outcome === 'seller') {
      const revenue = order.amount - order.sellerPayoutAmount;
      await this.ledger.post({
        legs: releaseEscrow(order.sellerId, order.sellerPayoutAmount, revenue),
        currency: order.currency,
        idempotencyKey: `release:${order.id}`,
        orderId: order.id,
        refType: 'dispute_release',
        refId: order.id,
      });
      return this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'completed', completedAt: new Date() },
      });
    }

    await this.ledger.post({
      legs: refundToBalance(order.buyerId, order.amount),
      currency: order.currency,
      idempotencyKey: `refund:${order.id}`,
      orderId: order.id,
      refType: 'dispute_refund',
      refId: order.id,
    });
    return this.prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });
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
