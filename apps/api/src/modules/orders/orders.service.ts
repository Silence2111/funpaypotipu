import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type Order, type OrderStatus, type Payment } from '@gamemarket/db';
import {
  canTransition,
  payToEscrowFromBalance,
  payToEscrowFromGateway,
  depositToBalance,
  refundToBalance,
  releaseEscrow,
  cashbackToBalance,
  maxPromoDiscount,
  dealEconomics,
  explainDeal,
  cashbackFor,
  topupAccountError,
  topupAmountError,
  topupQuote,
  maskContacts,
  qtyError,
  qtyTotal,
  soldByQty,
  buyerDataError,
  buyerFieldsOf,
  cleanBuyerData,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { LedgerService } from '../ledger/ledger.service';
import { EncryptionService } from '../crypto/encryption.service';
import { PromoService } from '../promo/promo.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatService } from '../chat/chat.service';
import { FeesService } from './fees.service';
import { FulfillmentService } from './fulfillment.service';

const AUTO_CONFIRM_TTL_MS = Number(process.env.ORDER_AUTO_CONFIRM_TTL_MS ?? 72 * 3600 * 1000); // docs/03

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly fees: FeesService,
    private readonly fulfillment: FulfillmentService,
    private readonly encryption: EncryptionService,
    private readonly promo: PromoService,
    private readonly notifications: NotificationsService,
    private readonly chat: ChatService,
  ) {}

  /** Системное сообщение о событии сделки в чат (не роняет основной поток). */
  private async sys(orderId: string, text: string) {
    await this.chat.postSystem(orderId, text).catch(() => {});
  }

  async create(
    buyerId: string,
    listingId: string,
    opts: { promoCode?: string; account?: string; topupAmount?: string; qty?: number; buyerData?: Record<string, string> } = {},
  ) {
    const { promoCode } = opts;
    const account = opts.account?.trim() || undefined;
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { game: { select: { slug: true } } },
    });
    if (listing?.status === 'sold_out') throw new BadRequestException('Лот закончился');
    if (!listing || listing.status !== 'active') throw new NotFoundException('Лот недоступен');
    if (listing.sellerId === buyerId) throw new BadRequestException('Нельзя купить собственный лот');
    if (listing.fulfillmentType === 'provider') {
      const accountError = topupAccountError(listing.game.slug, account);
      if (accountError) throw new BadRequestException(accountError);
    }

    // Лот «на сумму покупателя»: цена — номинал плюс наценка продавца, та же
    // функция считает её в виджете. Номинал уходит в снимок заказа: провайдер
    // должен зачислить именно его, а не сумму оплаты.
    let base = listing.price;
    let topupNominal: bigint | null = null;
    if (listing.topupMarkupBps != null && listing.topupMin != null && listing.topupMax != null) {
      if (!opts.topupAmount) throw new BadRequestException('Укажите сумму пополнения');
      topupNominal = BigInt(opts.topupAmount);
      const amountError = topupAmountError(topupNominal, {
        min: listing.topupMin,
        max: listing.topupMax,
      });
      if (amountError) throw new BadRequestException(amountError);
      base = topupQuote(topupNominal, listing.topupMarkupBps).price;
    } else if (opts.topupAmount) {
      throw new BadRequestException('У этого лота фиксированная цена — сумму выбирает продавец');
    }

    // Поштучно: цена лота — за пачку единиц, сумма — за выбранное количество.
    // Наличие здесь только проверяется, списывается оно при оплате (finalizePaid):
    // брошенный неоплаченный заказ не должен держать товар.
    let qty = 1;
    if (soldByQty(listing)) {
      qty = opts.qty ?? listing.minQty;
      const qtyErr = qtyError(qty, listing);
      if (qtyErr) throw new BadRequestException(qtyErr);
      base = qtyTotal(listing.price, listing.pricePerUnits, qty);
    } else if (opts.qty !== undefined && opts.qty !== 1) {
      throw new BadRequestException('Этот лот продаётся целиком');
    } else if (listing.stock != null && listing.stock < 1) {
      throw new BadRequestException('Лот закончился');
    }

    // Данные для выдачи (ник, сервер) — до оплаты: продавцу не придётся их выспрашивать.
    const buyerFields = buyerFieldsOf(listing.buyerFields);
    const buyerDataErr = buyerDataError(buyerFields, opts.buyerData);
    if (buyerDataErr) throw new BadRequestException(buyerDataErr);
    const buyerData = cleanBuyerData(buyerFields, opts.buyerData);

    const f = await this.fees.computeForCategory(
      base,
      listing.categoryId,
      listing.currency,
      listing.sellerId,
    );

    // Промокод: скидка снимается с комиссии площадки (не с выплаты продавцу).
    //
    // Потолком была вся валовая комиссия — то есть скидку разрешалось доводить
    // ровно до нуля. После этого кэшбэк покупателю и приём платежа платились
    // уже из своего кармана, и чем удачнее промоакция, тем больше убыток.
    // Теперь потолок считает `maxPromoDiscount`: из комиссии сначала
    // вычитается то, что площадка по этой сделке заплатит в любом случае.
    // Способ оплаты выбирают после создания заказа, поэтому потолок — по
    // самому дорогому для площадки способу. Сходится ли сделка при реальном
    // способе, пишется в журнал при оплате (logEconomics): запрещать её
    // не повод — покупатель ни при чём, — но знать об этом надо.
    let amount = f.amountToPay;
    if (promoCode) {
      const maxDiscount = maxPromoDiscount({ amountToPay: f.amountToPay, sellerPayout: f.sellerPayout });
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
          ...(account ? { account } : {}),
          ...(topupNominal != null ? { topupAmount: topupNominal.toString() } : {}),
          ...(buyerData.length ? { buyerData } : {}),
          ...(soldByQty(listing)
            ? {
                unitName: listing.unitName ?? 'шт.',
                unitPrice: listing.price.toString(),
                pricePerUnits: listing.pricePerUnits,
              }
            : {}),
        } as Prisma.InputJsonValue,
        qty,
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
    await this.sys(order.id, 'Заказ создан. Обсудите детали и дождитесь оплаты.');
    return order;
  }

  /**
   * Деньги шлюза по заказу. Вызывается из PaymentsService в той же
   * транзакции, где платёж отмечен успешным: статус заказа и проводка в
   * эскроу фиксируются вместе или не фиксируются вовсе.
   *
   * Заказ уже оплачен другим платежом, отменён или истёк, пока покупатель
   * платил, — деньги не зависают у шлюза, а целиком ложатся на его баланс.
   * Раньше такой вебхук падал на переходе статуса, и деньги терялись.
   */
  async capturePayment(tx: Prisma.TransactionClient, payment: Payment): Promise<'paid' | 'late'> {
    const order = await tx.order.findUnique({ where: { id: payment.orderId! } });
    if (!order) throw new NotFoundException('Заказ не найден');
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: 'created' },
      data: {
        status: 'paid',
        paidAt: new Date(),
        paymentMethod: payment.method,
        paymentSurcharge: payment.surcharge,
      },
    });
    if (claimed.count === 1) {
      await this.ledger.post(
        {
          legs: payToEscrowFromGateway(order.amount, payment.surcharge),
          currency: order.currency,
          idempotencyKey: `pay:${order.id}`,
          orderId: order.id,
          refType: 'order_payment',
          refId: order.id,
        },
        tx,
      );
      return 'paid';
    }
    await this.ledger.post(
      {
        legs: depositToBalance(order.buyerId, payment.amount - payment.surcharge, payment.surcharge),
        currency: payment.currency,
        idempotencyKey: `late:${payment.providerRef}`,
        orderId: order.id,
        refType: 'late_payment',
        refId: payment.id,
      },
      tx,
    );
    return 'late';
  }

  /** Шаги после оплаты шлюзом, вне денежной транзакции. */
  async afterCapture(orderId: string, outcome: 'paid' | 'late') {
    if (outcome === 'paid') return this.afterPaid(orderId);
    const order = await this.get(orderId);
    await this.notifications.notify(order.buyerId, 'payment_to_balance', { orderId });
    await this.sys(orderId, 'Пришла ещё одна оплата, когда заказ уже был оплачен или закрыт, — она зачислена на баланс покупателя.');
    return order;
  }

  /** Оплата заказа с баланса пользователя (без внешнего провайдера). */
  async payFromBalance(orderId: string, buyerId: string) {
    const order = await this.get(orderId);
    if (order.buyerId !== buyerId) throw new ForbiddenException('Это не ваш заказ');
    if (order.status === 'paid') return order;
    this.assertTransition(order.status, 'paid');

    const balance = await this.ledger.balanceOf(buyerId, order.currency);
    if (balance < order.amount) throw new BadRequestException('Недостаточно средств на балансе');

    // Двойной клик и параллельная оплата шлюзом: списывает тот, кто первым
    // перевёл заказ в «оплачен», второй раз деньги не уходят.
    const won = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: 'created' },
        data: { status: 'paid', paidAt: new Date(), paymentMethod: 'balance', paymentSurcharge: 0n },
      });
      if (claimed.count === 0) return false;
      await this.ledger.post(
        {
          legs: payToEscrowFromBalance(buyerId, order.amount),
          currency: order.currency,
          idempotencyKey: `pay:${order.id}`,
          orderId: order.id,
          refType: 'order_payment_balance',
          refId: order.id,
        },
        tx,
      );
      await this.ledger.assertNotOverdrawn(tx, buyerId, order.currency);
      return true;
    });
    if (!won) return this.get(order.id);
    return this.afterPaid(order.id);
  }

  /**
   * Что площадке остаётся от сделки при том способе оплаты, которым её
   * оплатили. При создании заказа способ ещё не известен — считаем здесь.
   */
  private logEconomics(order: Order) {
    const amountToPay = order.sellerPayoutAmount + order.feeSeller + order.feeBuyer;
    const econ = dealEconomics({
      amountToPay,
      sellerPayout: order.sellerPayoutAmount,
      promoDiscount: amountToPay - order.amount,
      paymentMethod: order.paymentMethod ?? 'balance',
    });
    if (!econ.ok) this.logger.warn(`Заказ ${order.publicNumber}: ${explainDeal(econ)}`);
  }

  /** Общий пост-оплатный шаг: наличие → уведомления → авто-исполнение. Статус paid уже стоит. */
  private async afterPaid(orderId: string) {
    const paid = await this.get(orderId);
    this.logEconomics(paid);
    if (!(await this.takeStock(paid))) return this.get(paid.id);
    await this.notifications.notify(paid.sellerId, 'order_paid', { orderId: paid.id });
    // Сколько передать — первым сообщением в чате сделки, как на FunPay.
    const unit = (paid.listingSnapshot as { unitName?: string } | null)?.unitName;
    const howMany =
      unit && (paid.qty > 1 || unit !== 'шт.')
        ? ` Количество: ${new Intl.NumberFormat('ru-RU').format(paid.qty)} ${unit}.`
        : '';
    await this.sys(paid.id, `Оплата поступила — средства защищены эскроу.${howMany}`);

    if (paid.fulfillmentType !== 'manual') {
      await this.fulfillment.autoFulfill(paid.id);
      const fulfilled = await this.get(paid.id);
      const topup = fulfilled.fulfillmentType === 'provider';
      if (fulfilled.status === 'delivered') {
        await this.notifications.notify(fulfilled.buyerId, 'order_delivered', { orderId: fulfilled.id });
        await this.sys(
          fulfilled.id,
          topup
            ? 'Пополнение отправлено. Проверьте баланс и подтвердите получение.'
            : 'Товар выдан автоматически. Заберите ключ на странице заказа.',
        );
      } else if (fulfilled.status === 'refunded') {
        await this.sys(
          fulfilled.id,
          topup
            ? 'Провайдер не принял пополнение — деньги вернулись на баланс покупателя.'
            : 'Товара не оказалось на складе — деньги вернулись на баланс покупателя.',
        );
      }
      return fulfilled;
    }
    return paid;
  }

  /**
   * Списание наличия обычного лота при оплате. Условный UPDATE: из двух
   * одновременных оплат последней единицы пройдёт одна, вторая получит
   * деньги назад сразу, а не будет ждать выдачи товара, которого нет.
   * Наличие авто-лота ведёт склад ключей (FulfillmentService).
   */
  private async takeStock(order: Order): Promise<boolean> {
    if (order.fulfillmentType !== 'manual') return true;
    const listing = await this.prisma.listing.findUnique({
      where: { id: order.listingId },
      select: { stock: true },
    });
    if (!listing || listing.stock == null) return true;

    const taken = await this.prisma.listing.updateMany({
      where: { id: order.listingId, stock: { gte: order.qty } },
      data: { stock: { decrement: order.qty } },
    });
    if (taken.count === 0) {
      await this.ledger.post({
        legs: refundToBalance(order.buyerId, order.amount),
        currency: order.currency,
        idempotencyKey: `refund:${order.id}`,
        orderId: order.id,
        refType: 'oos_refund',
        refId: order.id,
      });
      await this.prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });
      await this.notifications.notify(order.buyerId, 'order_refunded', { orderId: order.id, reason: 'out_of_stock' });
      await this.sys(order.id, 'Пока шла оплата, товар закончился — деньги вернулись на баланс покупателя.');
      return false;
    }
    // Распродано — лот уходит из каталога сам, как на FunPay.
    await this.prisma.listing.updateMany({
      where: { id: order.listingId, stock: 0, status: 'active' },
      data: { status: 'sold_out' },
    });
    return true;
  }

  /**
   * Деньги вернулись до выдачи — товар не ушёл, наличие возвращается, а
   * распроданный лот снова в продаже. После выдачи товар у покупателя:
   * наличие не трогаем.
   */
  private async restock(order: Order): Promise<void> {
    if (order.fulfillmentType !== 'manual') return;
    const listing = await this.prisma.listing.findUnique({
      where: { id: order.listingId },
      select: { stock: true, status: true },
    });
    if (!listing || listing.stock == null) return;
    await this.prisma.listing.update({
      where: { id: order.listingId },
      data: {
        stock: { increment: order.qty },
        ...(listing.status === 'sold_out' ? { status: 'active' as const } : {}),
      },
    });
  }

  /** Покупатель получает выданные ключи (расшифровка). */
  async revealKey(orderId: string, buyerId: string) {
    const order = await this.get(orderId);
    if (order.buyerId !== buyerId) throw new ForbiddenException('Это не ваш заказ');
    if (order.status !== 'delivered' && order.status !== 'completed') {
      throw new BadRequestException('Товар ещё не выдан');
    }
    const delivery = await this.prisma.delivery.findUnique({ where: { orderId } });
    const ref = delivery?.payloadRef as { goodId?: string; goodIds?: string[] } | null;
    // Заказы до продажи поштучно хранили один goodId.
    const ids = ref?.goodIds ?? (ref?.goodId ? [ref.goodId] : []);
    if (!ids.length) throw new NotFoundException('Для этого заказа нет авто-выданного ключа');
    const goods = await this.prisma.digitalGood.findMany({ where: { id: { in: ids } } });
    if (goods.length !== ids.length) throw new NotFoundException('Ключ не найден');
    const byId = new Map(goods.map((g) => [g.id, g]));
    const keys = ids.map((id) => this.encryption.decrypt(byId.get(id)!.payloadEnc));
    return { key: keys[0], keys };
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
    await this.sys(delivered.id, 'Продавец отметил выдачу. Проверьте товар и подтвердите получение.');
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
    await this.sys(
      order.id,
      opts.system
        ? 'Срок проверки истёк — заказ подтверждён автоматически. Средства переданы продавцу.'
        : 'Покупатель подтвердил получение. Сделка завершена, средства переданы продавцу.',
    );

    // Кэшбэк покупателю на баланс — наш ответ на «токены P» конкурентов (живые деньги).
    const cashback = cashbackFor(order.amount);
    if (cashback > 0n) {
      await this.ledger.post({
        legs: cashbackToBalance(order.buyerId, cashback),
        currency: order.currency,
        idempotencyKey: `cashback:${order.id}`,
        refType: 'cashback',
        refId: order.id,
      });
      await this.notifications.notify(order.buyerId, 'cashback', {
        orderId: order.id,
        amount: cashback.toString(),
      });
    }
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
      await this.sys(order.id, 'Заказ отменён до оплаты.');
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
      await this.restock(order);
      await this.notifications.notify(order.buyerId, 'order_refunded', { orderId: order.id });
      await this.sys(order.id, 'Заказ отменён, средства возвращены покупателю на баланс.');
      return res;
    }

    throw new ConflictException(`Нельзя отменить заказ в статусе ${order.status}`);
  }

  /**
   * Продавец возвращает деньги сам — как «Вернуть деньги» на FunPay: после
   * оплаты, после выдачи и во время спора (спор тогда закрывается в пользу
   * покупателя). Раньше вернуть можно было только до выдачи: продавец, который
   * ошибся с товаром, был вынужден ждать арбитра.
   */
  async refundBySeller(orderId: string, sellerId: string, reason?: string) {
    const order = await this.get(orderId);
    if (order.sellerId !== sellerId) throw new ForbiddenException('Вернуть деньги может только продавец');
    if (!['paid', 'delivered', 'disputed'].includes(order.status)) {
      throw new ConflictException('Деньги по этому заказу уже не у площадки');
    }
    this.assertTransition(order.status, 'refunded');
    const wasDisputed = order.status === 'disputed';
    const wasPaid = order.status === 'paid';

    await this.ledger.post({
      legs: refundToBalance(order.buyerId, order.amount),
      currency: order.currency,
      idempotencyKey: `refund:${order.id}`,
      orderId: order.id,
      refType: 'seller_refund',
      refId: order.id,
    });
    const res = await this.prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });
    if (wasPaid) await this.restock(order);
    if (wasDisputed) {
      await this.prisma.dispute.updateMany({
        where: { orderId: order.id, status: { in: ['open', 'in_review'] } },
        data: { status: 'resolved_buyer', resolutionNote: 'Продавец вернул деньги сам', resolvedAt: new Date() },
      });
    }
    await this.notifications.notify(order.buyerId, 'order_refunded', { orderId: order.id, reason: 'seller_refund' });
    // Причину пишет продавец, а системное сообщение не проходит фильтр чата:
    // без маскирования через «причину» уводили бы сделку в мессенджер.
    const why = reason?.trim() ? ` Причина: ${maskContacts(reason.trim()).masked}` : '';
    await this.sys(order.id, `Продавец вернул деньги покупателю на баланс.${why}`);
    return res;
  }

  /** Продавец не выдал товар в срок → системный возврат покупателю (вызывается sweep). */
  async refundOverdue(orderId: string) {
    const order = await this.get(orderId);
    if (order.status !== 'paid') return;
    await this.ledger.post({
      legs: refundToBalance(order.buyerId, order.amount),
      currency: order.currency,
      idempotencyKey: `refund:${order.id}`,
      orderId: order.id,
      refType: 'order_refund_overdue',
      refId: order.id,
    });
    await this.prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });
    await this.restock(order);
    await this.notifications.notify(order.buyerId, 'order_refunded', {
      orderId: order.id,
      reason: 'seller_timeout',
    });
    await this.notifications.notify(order.sellerId, 'order_cancelled', {
      orderId: order.id,
      reason: 'seller_timeout',
    });
    await this.sys(
      order.id,
      'Продавец не выдал товар в срок — заказ отменён автоматически, средства возвращены покупателю.',
    );
  }

  /** Перевод заказа в спор (вызывается disputes-модулем). */
  async markDisputed(orderId: string, userId: string) {
    const order = await this.get(orderId);
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('Нет доступа к заказу');
    }
    this.assertTransition(order.status, 'disputed');
    const res = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'disputed' },
    });
    await this.sys(order.id, 'Открыт спор. К обсуждению подключится арбитр площадки.');
    return res;
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
      const done = await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      await this.sys(order.id, 'Спор решён в пользу продавца. Средства переданы продавцу.');
      return done;
    }

    await this.ledger.post({
      legs: refundToBalance(order.buyerId, order.amount),
      currency: order.currency,
      idempotencyKey: `refund:${order.id}`,
      orderId: order.id,
      refType: 'dispute_refund',
      refId: order.id,
    });
    const refunded = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'refunded' },
    });
    await this.sys(order.id, 'Спор решён в пользу покупателя. Средства возвращены покупателю.');
    return refunded;
  }

  /**
   * Мои заказы: покупки, продажи или всё вместе, с фильтром по статусам.
   * Вторая сторона и название — сразу в ответе: список «Продажи» без них
   * превращался в столбик номеров.
   */
  async listMine(userId: string, q: { role?: 'buyer' | 'seller'; status?: OrderStatus[] } = {}) {
    const where: Prisma.OrderWhereInput =
      q.role === 'buyer'
        ? { buyerId: userId }
        : q.role === 'seller'
          ? { sellerId: userId }
          : { OR: [{ buyerId: userId }, { sellerId: userId }] };
    if (q.status?.length) where.status = { in: q.status };
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        buyer: { select: { profile: { select: { username: true } } } },
        seller: { select: { profile: { select: { username: true } } } },
      },
    });
    return rows.map(({ buyer, seller, ...o }) => {
      const asBuyer = o.buyerId === userId;
      return {
        ...o,
        role: asBuyer ? ('buyer' as const) : ('seller' as const),
        counterparty: (asBuyer ? seller : buyer).profile?.username ?? null,
        title: (o.listingSnapshot as { title?: string } | null)?.title ?? null,
        unitName: (o.listingSnapshot as { unitName?: string } | null)?.unitName ?? null,
      };
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
