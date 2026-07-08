import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { OrdersService } from './orders.service';

const SWEEP_INTERVAL_MS = Number(process.env.ORDER_SWEEP_INTERVAL_MS ?? 60_000);
const PAYMENT_TTL_MS = Number(process.env.ORDER_PAYMENT_TTL_MS ?? 30 * 60 * 1000);
// Дедлайн выдачи для ручных заказов (как 24ч у Playerok) → авто-возврат.
const FULFILL_DEADLINE_MS = Number(process.env.ORDER_FULFILL_DEADLINE_MS ?? 24 * 3600 * 1000);

/**
 * Периодический прогон таймеров сделок (docs/03):
 * - DELIVERED с истёкшим autoConfirmAt → авто-подтверждение (релиз эскроу);
 * - CREATED без оплаты дольше TTL → EXPIRED.
 * В in-process варианте; при масштабе выносится в BullMQ-воркер.
 */
@Injectable()
export class OrdersSweepService {
  private readonly logger = new Logger(OrdersSweepService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly orders: OrdersService,
  ) {}

  @Interval('orders-sweep', SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    const now = new Date();

    const toConfirm = await this.prisma.order.findMany({
      where: { status: 'delivered', autoConfirmAt: { lte: now } },
      select: { id: true, buyerId: true },
    });
    for (const o of toConfirm) {
      try {
        await this.orders.confirm(o.id, o.buyerId, { system: true });
        this.logger.log(`Авто-подтверждён заказ ${o.id}`);
      } catch (e) {
        this.logger.warn(`Авто-подтверждение ${o.id} не удалось: ${(e as Error).message}`);
      }
    }

    const expiredBefore = new Date(now.getTime() - PAYMENT_TTL_MS);
    const toExpire = await this.prisma.order.updateMany({
      where: { status: 'created', createdAt: { lte: expiredBefore } },
      data: { status: 'expired' },
    });
    if (toExpire.count) this.logger.log(`Просрочено неоплаченных заказов: ${toExpire.count}`);

    // Оплаченные ручные заказы без выдачи дольше дедлайна → авто-возврат покупателю.
    const overdueBefore = new Date(now.getTime() - FULFILL_DEADLINE_MS);
    const overdue = await this.prisma.order.findMany({
      where: { status: 'paid', fulfillmentType: 'manual', paidAt: { lte: overdueBefore } },
      select: { id: true },
    });
    for (const o of overdue) {
      try {
        await this.orders.refundOverdue(o.id);
        this.logger.log(`Авто-возврат просроченного заказа ${o.id}`);
      } catch (e) {
        this.logger.warn(`Авто-возврат ${o.id} не удался: ${(e as Error).message}`);
      }
    }
  }
}
