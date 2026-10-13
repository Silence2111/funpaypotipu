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
import { chargeFor, depositToBalance, type GatewayMethodKey } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { OrdersService } from '../orders/orders.service';
import { LedgerService } from '../ledger/ledger.service';
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
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Пополнение баланса пользователя (не под заказ). На баланс приходит
   * `amount`, шлюз берёт его плюс надбавку способа оплаты.
   */
  async createBalanceDeposit(userId: string, amount: bigint, method: GatewayMethodKey = 'sbp', currency = 'RUB') {
    if (amount <= 0n) throw new BadRequestException('Сумма должна быть положительной');
    const { charge, surcharge } = chargeFor(amount, method);
    const provider = this.registry.get(this.registry.defaultKey);
    const providerRef = randomUUID();
    await this.prisma.payment.create({
      data: { userId, provider: provider.key, providerRef, amount: charge, surcharge, method, currency, status: 'pending' },
    });
    const session = await provider.createDeposit({ amount: charge, currency, orderId: '', providerRef, method });
    return { providerRef, url: session.url, amount: charge.toString(), surcharge: surcharge.toString(), method };
  }

  /**
   * Депозит под оплату заказа выбранным способом. Шлюз берёт сумму заказа
   * плюс надбавку способа (карта +4.4%) — ту же, что на кнопке «Оплатить».
   */
  async createDeposit(orderId: string, userId: string, method: GatewayMethodKey = 'sbp') {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.buyerId !== userId) throw new ForbiddenException('Это не ваш заказ');
    if (order.status !== 'created') throw new BadRequestException('Заказ уже оплачен или закрыт');

    const { charge, surcharge } = chargeFor(order.amount, method);
    const provider = this.registry.get(this.registry.defaultKey);
    const providerRef = randomUUID();
    await this.prisma.payment.create({
      data: {
        userId,
        orderId,
        provider: provider.key,
        providerRef,
        amount: charge,
        surcharge,
        method,
        currency: order.currency,
        status: 'pending',
      },
    });

    const session = await provider.createDeposit({
      amount: charge,
      currency: order.currency,
      orderId,
      providerRef,
      method,
    });
    return { orderId, providerRef, url: session.url, amount: charge.toString(), surcharge: surcharge.toString(), method };
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
    // Подпись доказывает только, что событие от этого провайдера. Платёж
    // другого провайдера он подтверждать не может: иначе заглушка, которая
    // зарегистрирована всегда, подтверждала бы боевые платежи — деньги на
    // баланс без денег на счёте.
    if (payment.provider !== provider.key) {
      throw new UnauthorizedException('Платёж создан другим провайдером');
    }
    if (payment.status === 'succeeded') return { ok: true, alreadyProcessed: true };

    if (event.status === 'failed') {
      await this.prisma.payment.update({ where: { providerRef: event.providerRef }, data: { status: 'failed' } });
      return { ok: true, status: 'failed' };
    }

    // Отметка платежа и деньги — одной транзакцией. Из двух одновременных
    // доставок вебхука проходит одна; упавшая на полпути обработка
    // откатывается целиком, и повтор вебхука проведёт платёж заново.
    const outcome = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { providerRef: event.providerRef, status: { not: 'succeeded' } },
        data: { status: 'succeeded' },
      });
      if (claimed.count === 0) return 'duplicate' as const;
      if (payment.orderId) return this.orders.capturePayment(tx, payment);
      // Пополнение баланса: провайдер → баланс пользователя, надбавка — отдельно.
      await this.ledger.post(
        {
          legs: depositToBalance(payment.userId, payment.amount - payment.surcharge, payment.surcharge),
          currency: payment.currency,
          idempotencyKey: `topup:${event.providerRef}`,
          refType: 'balance_topup',
          refId: payment.id,
        },
        tx,
      );
      return 'balance' as const;
    });
    if (outcome === 'duplicate') return { ok: true, alreadyProcessed: true };
    if (payment.orderId && outcome !== 'balance') await this.orders.afterCapture(payment.orderId, outcome);
    return { ok: true };
  }

  /**
   * Dev-шорткат для демо-оплаты (BuyButton): сам подписывает событие как
   * mock-провайдер. Работает, только пока платежи и правда идут через
   * заглушку: при настоящем провайдере это открытая кнопка «оплачено».
   */
  async devConfirm(providerRef: string) {
    if (this.registry.defaultKey !== this.mock.key) throw new NotFoundException();
    const signature = this.mock.sign(providerRef, 'succeeded');
    return this.handleWebhook('mock', { providerRef, status: 'succeeded', signature });
  }
}
