import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { OrdersService } from '../orders/orders.service';
import { MockPaymentProvider } from './mock.provider';
import { PaymentProviderRegistry } from './provider.registry';
import type { WebhookPayload } from './payment.provider';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly registry: PaymentProviderRegistry,
    private readonly mock: MockPaymentProvider,
    private readonly orders: OrdersService,
  ) {}

  /** Создать депозит под оплату заказа через провайдера по умолчанию. */
  async createDeposit(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.buyerId !== userId) throw new ForbiddenException('Это не ваш заказ');
    if (order.status !== 'created') throw new BadRequestException('Заказ уже оплачен или закрыт');

    const provider = this.registry.get(this.registry.defaultKey);
    const providerRef = randomUUID();
    await this.prisma.payment.create({
      data: {
        userId,
        orderId,
        provider: provider.key,
        providerRef,
        amount: order.amount,
        currency: order.currency,
        status: 'pending',
      },
    });

    const session = await provider.createDeposit({
      amount: order.amount,
      currency: order.currency,
      orderId,
      providerRef,
    });
    return { orderId, providerRef, url: session.url };
  }

  /**
   * Обработка вебхука провайдера: верификация подписи → идемпотентное проведение.
   * Так реальный шлюз уведомляет об оплате (docs/04).
   */
  async handleWebhook(providerKey: string, payload: WebhookPayload) {
    const provider = this.registry.get(providerKey);
    const event = provider.verifyWebhook(payload);
    if (!event) throw new UnauthorizedException('Невалидная подпись вебхука');

    const payment = await this.prisma.payment.findUnique({
      where: { providerRef: event.providerRef },
    });
    if (!payment) throw new NotFoundException('Платёж не найден');
    if (payment.status === 'succeeded') return { ok: true, alreadyProcessed: true };

    if (event.status === 'failed') {
      await this.prisma.payment.update({ where: { providerRef: event.providerRef }, data: { status: 'failed' } });
      return { ok: true, status: 'failed' };
    }

    await this.prisma.payment.update({ where: { providerRef: event.providerRef }, data: { status: 'succeeded' } });
    if (payment.orderId) await this.orders.markPaid(payment.orderId);
    return { ok: true };
  }

  /** Dev-шорткат для демо-оплаты (BuyButton): сам подписывает событие как mock-провайдер. */
  async devConfirm(providerRef: string) {
    const signature = this.mock.sign(providerRef, 'succeeded');
    return this.handleWebhook('mock', { providerRef, status: 'succeeded', signature });
  }
}
