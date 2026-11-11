import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@gamemarket/db';
import { chargeFor, depositToBalance, type GatewayMethodKey } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { AntifraudService } from '../trust/antifraud.service';
import { OrdersService } from '../orders/orders.service';
import { LedgerService } from '../ledger/ledger.service';
import { SafeDealService } from '../safe-deal/safe-deal.service';
import { MockPaymentProvider, type MockWebhookPayload } from './mock.provider';
import { PaymentProviderRegistry } from './provider.registry';
import type { DepositSession } from './payment.provider';

const webUrl = () => (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly registry: PaymentProviderRegistry,
    private readonly mock: MockPaymentProvider,
    private readonly orders: OrdersService,
    private readonly ledger: LedgerService,
    private readonly safeDeal: SafeDealService,
    // Частота оплат и лимит новичка (часть 128); в юнит-тестах — без него.
    @Optional() private readonly antifraud?: AntifraudService,
  ) {}

  /**
   * Пополнение баланса пользователя (не под заказ). На баланс приходит
   * `amount`, шлюз берёт его плюс надбавку способа оплаты.
   */
  async createBalanceDeposit(userId: string, amount: bigint, method: GatewayMethodKey = 'sbp', currency = 'RUB') {
    if (amount <= 0n) throw new BadRequestException('Сумма должна быть положительной');
    // «Безопасная сделка» (часть 123): деньги покупателей держит ЮKassa, а не площадка.
    if ((await this.safeDeal.scheme()) === 'safe_deal') {
      throw new BadRequestException('Пополнение баланса недоступно: оплата идёт через «Безопасную сделку» ЮKassa — заказ оплачивается картой');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const session = await this.openDeposit({
      userId,
      orderId: null,
      amount,
      method,
      currency,
      description: 'Пополнение баланса GameMarket',
      returnUrl: `${webUrl()}/cabinet/wallet?topup=1`,
      customerEmail: user?.email ?? null,
    });
    return { ...session, method };
  }

  /**
   * Депозит под оплату заказа выбранным способом. Шлюз берёт сумму заказа
   * плюс надбавку способа (карта +4.4%) — ту же, что на кнопке «Оплатить».
   */
  async createDeposit(orderId: string, userId: string, method: GatewayMethodKey = 'sbp') {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { buyer: { select: { email: true } } },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.buyerId !== userId) throw new ForbiddenException('Это не ваш заказ');
    if (order.status !== 'created') throw new BadRequestException('Заказ уже оплачен или закрыт');

    // «Безопасная сделка» (часть 123): сделка у ЮKassa на заказ, оплата — картой,
    // в платеже — доля продавца, остальное — вознаграждение площадки.
    let deal: { id: string; sellerAmount: bigint } | undefined;
    if (order.dealId || (await this.safeDeal.scheme()) === 'safe_deal') {
      this.safeDeal.assertMethod(method);
      deal = { id: await this.safeDeal.ensureDeal(order), sellerAmount: order.sellerPayoutAmount };
    }

    const session = await this.openDeposit({
      userId,
      orderId,
      amount: order.amount,
      method,
      currency: order.currency,
      description: `Заказ ${order.publicNumber} на GameMarket`,
      // Со страницы шлюза — обратно на заказ: там видно, дошла ли оплата.
      returnUrl: `${webUrl()}/orders/${orderId}?paid=1`,
      customerEmail: order.buyer?.email ?? null,
      deal,
    });
    return { orderId, ...session, method, ...(deal ? { dealId: deal.id } : {}) };
  }

  /**
   * Платёж у шлюза: строка в базе до запроса (по ней придёт вебхук), потом
   * сессия оплаты. Шлюз не принял — платёж помечается неудачным, а не висит.
   */
  /**
   * Отмена с возвратом исходным способом (часть 137): шлюз возвращает всё,
   * что списал, — сумму и надбавку способа. Платёж — тот, которым оплачен заказ.
   */
  async cancelToOriginal(orderId: string, userId: string) {
    return this.orders.cancelToOriginal(orderId, userId, async (order) => {
      const payment = await this.prisma.payment.findFirst({
        where: { orderId: order.id, status: 'succeeded' },
        orderBy: { createdAt: 'desc' },
      });
      if (!payment) throw new Error('Платёж заказа не найден');
      const provider = this.registry.get(payment.provider);
      if (!provider.refund) throw new Error(`Шлюз ${payment.provider} не умеет возвраты`);
      await provider.refund({
        externalId: payment.externalId,
        providerRef: payment.providerRef,
        amount: payment.amount,
        currency: payment.currency,
        idempotenceKey: `refund-${order.id}`,
        description: `Возврат по заказу ${order.publicNumber}`,
      });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'refunded' } });
    });
  }

  private async openDeposit(p: {
    userId: string;
    orderId: string | null;
    amount: bigint;
    method: GatewayMethodKey;
    currency: string;
    description: string;
    returnUrl: string;
    customerEmail: string | null;
    deal?: { id: string; sellerAmount: bigint };
  }) {
    const provider = this.registry.current;
    if (!provider.methods.includes(p.method)) {
      throw new BadRequestException('Этот способ оплаты сейчас недоступен — выберите другой.');
    }
    const { charge, surcharge } = chargeFor(p.amount, p.method);
    await this.antifraud?.assertCanPay(p.userId, charge);
    const providerRef = randomUUID();
    await this.prisma.payment.create({
      data: {
        userId: p.userId,
        orderId: p.orderId,
        provider: provider.key,
        providerRef,
        amount: charge,
        surcharge,
        method: p.method,
        currency: p.currency,
        status: 'pending',
      },
    });
    let session: DepositSession;
    try {
      session = await provider.createDeposit({
        amount: charge,
        currency: p.currency,
        orderId: p.orderId ?? '',
        providerRef,
        method: p.method,
        description: p.description,
        returnUrl: p.returnUrl,
        customerEmail: p.customerEmail,
        ...(p.deal ? { deal: p.deal } : {}),
      });
    } catch (e) {
      await this.prisma.payment.update({ where: { providerRef }, data: { status: 'failed' } });
      throw e;
    }
    if (session.externalId) {
      await this.prisma.payment.update({ where: { providerRef }, data: { externalId: session.externalId } });
    }
    return {
      providerRef,
      url: session.url,
      redirect: session.redirect,
      amount: charge.toString(),
      surcharge: surcharge.toString(),
    };
  }

  /**
   * Обработка вебхука провайдера: верификация подписи → идемпотентное проведение.
   * Так реальный шлюз уведомляет об оплате (docs/04).
   */
  async handleWebhook(providerKey: string, body: unknown) {
    const provider = this.registry.get(providerKey);
    const event = await provider.parseWebhook(body);
    // Событие не про оплату или платёж ещё идёт — шлюзу «принято», без действий.
    if (event === 'ignore') return { ok: true, ignored: true };
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
    // Сумму и валюту шлюз сообщает свои — они обязаны совпасть с платежом в
    // базе: иначе оплата 1 ₽ закрыла бы заказ на 10 000 ₽.
    if (event.amount !== undefined && (event.amount !== payment.amount || event.currency !== payment.currency)) {
      this.logger.error(
        `Платёж ${payment.providerRef}: шлюз сообщил ${event.amount} ${event.currency}, ожидалось ${payment.amount} ${payment.currency}`,
      );
      throw new BadRequestException('Сумма платежа не совпадает с заказом');
    }

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
        data: { status: 'succeeded', ...(event.card ? { card: { ...event.card } } : {}) },
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
    return this.handleWebhook('mock', { providerRef, status: 'succeeded', signature } satisfies MockWebhookPayload);
  }
}
