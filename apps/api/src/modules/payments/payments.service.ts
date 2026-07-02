import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { OrdersService } from '../orders/orders.service';
import { MockPaymentProvider } from './mock.provider';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly provider: MockPaymentProvider,
    private readonly orders: OrdersService,
  ) {}

  /** Создать депозит под оплату заказа. Возвращает ссылку/реквизиты. */
  async createDeposit(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.buyerId !== userId) throw new ForbiddenException('Это не ваш заказ');
    if (order.status !== 'created') throw new BadRequestException('Заказ уже оплачен или закрыт');

    const providerRef = randomUUID();
    await this.prisma.payment.create({
      data: {
        userId,
        orderId,
        provider: this.provider.key,
        providerRef,
        amount: order.amount,
        currency: order.currency,
        status: 'pending',
      },
    });

    const session = await this.provider.createDeposit({
      amount: order.amount,
      currency: order.currency,
      orderId,
      providerRef,
    });
    return { orderId, providerRef, url: session.url };
  }

  /** Имитация вебхука провайдера. Идемпотентно по providerRef. */
  async handleCallback(providerRef: string) {
    const payment = await this.prisma.payment.findUnique({ where: { providerRef } });
    if (!payment) throw new NotFoundException('Платёж не найден');
    if (payment.status === 'succeeded') return { ok: true, alreadyProcessed: true };

    await this.prisma.payment.update({
      where: { providerRef },
      data: { status: 'succeeded' },
    });
    if (payment.orderId) await this.orders.markPaid(payment.orderId);
    return { ok: true };
  }
}
