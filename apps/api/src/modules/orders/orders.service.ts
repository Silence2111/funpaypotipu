import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  HttpException,
  ServiceUnavailableException,
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
  qtyPrice,
  qtyTiers,
  soldByQty,
  buyerDataError,
  buyerFieldsOf,
  cleanBuyerData,
  DISPUTE_NOTES,
  SALE_MIN_PRICE,
  sellerPromoDiscount,
  serviceDueAt,
  warrantyActive,
  warrantyUntil,
  BUYER_DISPUTES_DAYS,
  buyerFilterActive,
  buyerFilterMiss,
  buyerFilterOf,
  canRefundToOriginal,
  refundToOriginal,
  disputeSplit,
  splitEscrow,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { likeText } from '../../common/like';
import { LedgerService } from '../ledger/ledger.service';
import { EncryptionService } from '../crypto/encryption.service';
import { PromoService } from '../promo/promo.service';
import { SellerPromosService } from '../promo/seller-promos.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatService } from '../chat/chat.service';
import { PartnersService } from '../partners/partners.service';
import { SafeDealService } from '../safe-deal/safe-deal.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { AntifraudService } from '../trust/antifraud.service';
import { FeesService } from './fees.service';
import { FulfillmentService } from './fulfillment.service';

const AUTO_CONFIRM_TTL_MS = Number(process.env.ORDER_AUTO_CONFIRM_TTL_MS ?? 72 * 3600 * 1000); // docs/03

/** Ники сторон заказа — для списка. */
const WITH_PARTIES = {
  buyer: { select: { profile: { select: { username: true } } } },
  seller: { select: { profile: { select: { username: true } } } },
} as const;
type PartyName = { profile: { username: string } | null };

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
    private readonly sellerPromos: SellerPromosService,
    private readonly partners: PartnersService,
    private readonly safeDeal: SafeDealService,
    // Вебхук продавца (часть 127); в юнит-тестах может не быть.
    @Optional() private readonly webhooks?: WebhooksService,
    // Сделки между связанными аккаунтами (часть 128); в юнит-тестах — без него.
    @Optional() private readonly antifraud?: AntifraudService,
  ) {}

  /**
   * Вернуть деньги покупателю: заказ в «Безопасной сделке» (часть 123) — на
   * карту через ЮKassa, иначе — на баланс у площадки.
   */
  private async refundBuyer(order: Order, refType: string) {
    if (order.dealId) return this.safeDeal.refund(order, refType);
    await this.ledger.post({
      legs: refundToBalance(order.buyerId, order.amount),
      currency: order.currency,
      idempotencyKey: `refund:${order.id}`,
      orderId: order.id,
      refType,
      refId: order.id,
    });
  }

  /** Завершить: в сделке — выплата продавцу по ней, иначе — на его баланс. */
  private async releaseSeller(order: Order, refType: string) {
    if (order.dealId) return this.safeDeal.release(order, refType);
    const revenue = order.amount - order.sellerPayoutAmount;
    await this.ledger.post({
      legs: releaseEscrow(order.sellerId, order.sellerPayoutAmount, revenue),
      currency: order.currency,
      idempotencyKey: `release:${order.id}`,
      orderId: order.id,
      refType,
      refId: order.id,
    });
  }

  /** Куда ушли деньги покупателя — для сообщений в чате. */
  private refundedTo(order: Order) {
    return order.dealId ? 'на карту' : 'на баланс';
  }

  /** Системное сообщение о событии сделки в чат (не роняет основной поток). */
  private async sys(orderId: string, text: string) {
    await this.chat.postSystem(orderId, text).catch(() => {});
  }

  /**
   * Сообщение продавца из лота сразу после оплаты: как войти, что сделать
   * после получения. Приходит от его имени, а не от площадки. Как и
   * системные, не роняет оплату: деньги уже в эскроу.
   */
  private async sellerNote(order: Order) {
    try {
      const listing = await this.prisma.listing.findUnique({
        where: { id: order.listingId },
        select: { deliveryTemplate: true },
      });
      if (listing?.deliveryTemplate) await this.chat.postFromSeller(order.id, listing.deliveryTemplate);
    } catch (e) {
      this.logger.warn(`Сообщение продавца по заказу ${order.publicNumber}: ${(e as Error).message}`);
    }
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
      include: { game: { select: { slug: true } }, category: { select: { fulfillmentType: true } } },
    });
    if (listing?.status === 'sold_out') throw new BadRequestException('Лот закончился');
    if (!listing || listing.status !== 'active') throw new NotFoundException('Лот недоступен');
    if (listing.sellerId === buyerId) throw new BadRequestException('Нельзя купить собственный лот');
    // Свой второй аккаунт — тоже свой лот: накрутка продаж и кэшбэк с себя (часть 128).
    await this.antifraud?.assertNotLinked(buyerId, listing.sellerId);
    // Кому продавать — решает продавец (часть 136).
    await this.assertBuyerFits(buyerId, listing.sellerId);
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

    // Поштучно: цена лота — за пачку единиц, сумма — за выбранное количество,
    // со скидкой за количество, если продавец её задал (оплачивает он: сумма
    // снижается до расчёта комиссии). Наличие здесь только проверяется,
    // списывается оно при оплате (finalizePaid): брошенный неоплаченный
    // заказ не должен держать товар.
    let qty = 1;
    let qtyDeal: ReturnType<typeof qtyPrice> | null = null;
    if (soldByQty(listing)) {
      qty = opts.qty ?? listing.minQty;
      const qtyErr = qtyError(qty, listing);
      if (qtyErr) throw new BadRequestException(qtyErr);
      qtyDeal = qtyPrice(listing.price, listing.pricePerUnits, qty, qtyTiers(listing.qtyDiscounts));
      base = qtyDeal.total;
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
    // Ссылка на обмен Steam (часть 142) — в профиль: подставится в следующий заказ.
    const steamField = buyerFields.find((f) => f.kind === 'steam_trade');
    const steamUrl = steamField ? buyerData.find((a) => a.label === steamField.label)?.value : undefined;
    if (steamUrl) {
      await this.prisma.profile.updateMany({ where: { userId: buyerId }, data: { steamTradeUrl: steamUrl } }).catch(() => null);
    }

    // Промокод продавца — раньше кода площадки: скидка за счёт продавца,
    // цена снижается до расчёта комиссии, и площадка берёт её с того, что
    // заплатил покупатель. Код продавца не подошёл — отказ с причиной.
    const listPrice = base;
    const sellerPromo = promoCode ? await this.sellerPromos.check(promoCode, listing, buyerId) : null;
    const promoDiscount = sellerPromo ? sellerPromoDiscount(base, sellerPromo.percent) : 0n;
    if (base - promoDiscount < SALE_MIN_PRICE) {
      throw new BadRequestException('Со скидкой цена меньше 1 ₽');
    }
    base -= promoDiscount;

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
    if (promoCode && !sellerPromo) {
      const maxDiscount = maxPromoDiscount({ amountToPay: f.amountToPay, sellerPayout: f.sellerPayout });
      amount -= await this.promo.consume(promoCode, f.amountToPay, maxDiscount);
    }

    const data: Prisma.OrderUncheckedCreateInput = {
      publicNumber: `GM-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4)}`,
      buyerId,
      sellerId: listing.sellerId,
      listingId,
      listingSnapshot: {
        title: listing.title,
        basePrice: listPrice.toString(),
        ...(sellerPromo
          ? {
              sellerPromo: {
                code: sellerPromo.code,
                percent: sellerPromo.percent,
                discount: promoDiscount.toString(),
              },
            }
          : {}),
        currency: listing.currency,
        ...(account ? { account } : {}),
        ...(topupNominal != null ? { topupAmount: topupNominal.toString() } : {}),
        ...(buyerData.length ? { buyerData } : {}),
        // Срок выполнения услуги (часть 125): «выполнить до» считается от оплаты.
        ...(listing.serviceHours && listing.fulfillmentType === 'manual' ? { serviceHours: listing.serviceHours } : {}),
        // Гарантия продавца (часть 126): спор после подтверждения в этот срок.
        ...(listing.warrantyDays ? { warrantyDays: listing.warrantyDays } : {}),
        // Автовыдача аккаунта или предмета: заказ называет выданное
        // товаром, а не ключом. Ключи и прежние заказы — без пометки.
        ...(listing.fulfillmentType === 'auto_key' && listing.category.fulfillmentType === 'manual'
          ? { goods: 'item' }
          : {}),
        ...(soldByQty(listing)
          ? {
              unitName: listing.unitName ?? 'шт.',
              unitPrice: listing.price.toString(),
              pricePerUnits: listing.pricePerUnits,
            }
          : {}),
        ...(qtyDeal?.tier
          ? {
              qtyDiscount: {
                from: qtyDeal.tier.from,
                pct: qtyDeal.tier.pct,
                discount: qtyDeal.discount.toString(),
              },
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
    };
    // Заказ по коду продавца — в транзакции с блокировкой кода: проверка
    // повторяется, и два заказа не займут последнее использование вдвоём.
    const order = sellerPromo
      ? await this.prisma.$transaction(async (tx) => {
          await this.sellerPromos.check(promoCode!, listing, buyerId, tx, true);
          const created = await tx.order.create({ data });
          await tx.sellerPromoUse.create({
            data: { promoId: sellerPromo.id, buyerId, orderId: created.id, discount: promoDiscount },
          });
          return created;
        })
      : await this.prisma.order.create({ data });
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
    // «Безопасная сделка» (часть 123): деньги площадки в сделку ЮKassa не попадают.
    if (order.dealId || (await this.safeDeal.scheme()) === 'safe_deal') {
      throw new BadRequestException('Оплата с баланса недоступна: платежи идут через «Безопасную сделку» ЮKassa — оплатите картой');
    }

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
    let paid = await this.get(orderId);
    this.logEconomics(paid);
    if (!(await this.takeStock(paid))) return this.get(paid.id);
    // Услуга со сроком (часть 125): «выполнить до» — от оплаты.
    const hours = (paid.listingSnapshot as { serviceHours?: number } | null)?.serviceHours;
    if (hours && paid.fulfillmentType === 'manual' && !paid.serviceDueAt) {
      paid = await this.prisma.order.update({
        where: { id: paid.id },
        data: { serviceDueAt: serviceDueAt(paid.paidAt ?? new Date(), hours) },
      });
    }
    // manual — выдаёт сам продавец: в Telegram под уведомлением «Отметить выдачу».
    await this.notifications.notify(paid.sellerId, 'order_paid', {
      orderId: paid.id,
      ...(paid.fulfillmentType === 'manual' ? { manual: true } : {}),
    });
    // API продавца (часть 127): «оплачен новый заказ» — на его вебхук, если задан.
    // Сбой вебхука не мешает сделке: доставка повторится сама.
    const snap = (paid.listingSnapshot ?? {}) as { title?: string; buyerData?: unknown };
    await this.webhooks
      ?.enqueue(paid.sellerId, 'order.paid', {
        id: paid.id,
        publicNumber: paid.publicNumber,
        listingId: paid.listingId,
        title: snap.title ?? null,
        qty: paid.qty,
        amount: paid.amount.toString(),
        sellerPayout: paid.sellerPayoutAmount.toString(),
        currency: paid.currency,
        buyerData: snap.buyerData ?? [],
        autoDelivery: paid.fulfillmentType !== 'manual',
        paidAt: paid.paidAt,
        // Услуга со сроком (часть 125): выполнить до; null — сутки на выдачу.
        serviceDueAt: paid.serviceDueAt,
      })
      .catch((e: Error) => this.logger.warn(`Вебхук заказа ${paid.id}: ${e.message}`));
    // Сколько передать — первым сообщением в чате сделки, как на FunPay.
    const unit = (paid.listingSnapshot as { unitName?: string } | null)?.unitName;
    const howMany =
      unit && (paid.qty > 1 || unit !== 'шт.')
        ? ` Количество: ${new Intl.NumberFormat('ru-RU').format(paid.qty)} ${unit}.`
        : '';
    // В «Безопасной сделке» (часть 123) деньги держит ЮKassa, а не площадка.
    const held = paid.dealId ? 'деньги держит ЮKassa в «Безопасной сделке»' : 'средства защищены эскроу';
    await this.sys(paid.id, `Оплата поступила — ${held}.${howMany}`);
    if (paid.serviceDueAt) {
      await this.sys(
        paid.id,
        'Срок выполнения — на странице заказа. Не успеет продавец — можно сразу открыть спор; без выдачи и спора деньги вернутся через сутки после срока.',
      );
    }

    if (paid.fulfillmentType !== 'manual') {
      await this.fulfillment.autoFulfill(paid.id);
      const fulfilled = await this.get(paid.id);
      const topup = fulfilled.fulfillmentType === 'provider';
      if (fulfilled.status === 'delivered') {
        await this.notifications.notify(fulfilled.buyerId, 'order_delivered', { orderId: fulfilled.id });
        const item = (fulfilled.listingSnapshot as { goods?: string } | null)?.goods === 'item';
        await this.sys(
          fulfilled.id,
          topup
            ? 'Пополнение отправлено. Проверьте баланс и подтвердите получение.'
            : item
              ? 'Товар выдан автоматически — он на странице заказа. Проверьте его и подтвердите получение.'
              : 'Товар выдан автоматически. Заберите ключ на странице заказа.',
        );
        await this.sellerNote(fulfilled);
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
    await this.sellerNote(paid);
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
      select: { stock: true, fulfillmentType: true },
    });
    // Продавец включил автовыдачу, пока заказ ждал оплаты: наличие теперь —
    // строки склада, а этот заказ он выдаст сам, как оформлено.
    if (!listing || listing.stock == null || listing.fulfillmentType !== 'manual') return true;

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
      select: { stock: true, status: true, fulfillmentType: true },
    });
    if (!listing || listing.stock == null || listing.fulfillmentType !== 'manual') return;
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
    // Журнал выдачи (часть 135): когда покупатель впервые открыл товар и сколько раз.
    await this.prisma.delivery
      .update({
        where: { orderId },
        data: { viewCount: { increment: 1 }, ...(delivery?.firstViewedAt ? {} : { firstViewedAt: new Date() }) },
      })
      .catch(() => null);
    return { key: keys[0], keys };
  }

  /**
   * Фильтр покупателей продавца (часть 136): возраст аккаунта, проигранные
   * споры за 90 дней, оценки других продавцов. Не проходит — 403 с тем,
   * какое условие не выполнено; условия видны на странице лота заранее.
   */
  private async assertBuyerFits(buyerId: string, sellerId: string) {
    const seller = await this.prisma.profile.findUnique({ where: { userId: sellerId }, select: { buyerFilter: true } });
    const filter = buyerFilterOf(seller?.buyerFilter);
    if (!buyerFilterActive(filter)) return;
    const since = new Date(Date.now() - BUYER_DISPUTES_DAYS * 86_400_000);
    const [user, lost, reviews] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: buyerId }, select: { createdAt: true } }),
      this.prisma.dispute.count({ where: { status: 'resolved_seller', resolvedAt: { gte: since }, order: { buyerId } } }),
      this.prisma.buyerReview.groupBy({ by: ['good'], where: { buyerId }, _count: { _all: true } }),
    ]);
    const miss = buyerFilterMiss(filter, {
      ageDays: user ? (Date.now() - user.createdAt.getTime()) / 86_400_000 : 0,
      lostDisputes: lost,
      goodReviews: reviews.find((r) => r.good)?._count._all ?? 0,
      badReviews: reviews.find((r) => !r.good)?._count._all ?? 0,
    });
    if (!miss) return;
    const filterWhy =
      miss === 'age'
        ? `Продавец продаёт покупателям с аккаунтом не моложе ${filter.minAgeDays} дн.`
        : miss === 'disputes'
          ? 'Продавец не продаёт покупателям с проигранными спорами за последние 90 дней.'
          : 'Продавец не продаёт покупателям, которых другие продавцы чаще не рекомендуют.';
    throw new HttpException({ statusCode: 403, error: 'buyer_filtered', message: filterWhy, reason: miss }, 403);
  }

  /**
   * «Данные получены» (часть 136): при ручной выдаче покупатель отмечает,
   * что продавец передал данные. Это не подтверждение качества — проверить
   * можно и после, — а факт передачи для арбитра: в журнал выдачи спора.
   */
  async markReceived(orderId: string, buyerId: string) {
    const order = await this.get(orderId);
    if (order.buyerId !== buyerId) throw new ForbiddenException('Это не ваш заказ');
    if (order.fulfillmentType !== 'manual' || order.status !== 'delivered') {
      throw new BadRequestException('Отметить «данные получены» можно после ручной выдачи');
    }
    if (order.receivedAt) return order;
    const updated = await this.prisma.order.update({ where: { id: order.id }, data: { receivedAt: new Date() } });
    await this.sys(order.id, 'Покупатель отметил: данные получены.');
    return updated;
  }

  /**
   * «Взял в работу» (часть 125): продавец показывает покупателю, что заказ не
   * забыт. Статус не меняется — заказ оплачен и ждёт выдачи, сроки те же.
   */
  async startWork(orderId: string, sellerId: string) {
    const order = await this.get(orderId);
    if (order.sellerId !== sellerId) throw new ForbiddenException('Это не ваш заказ');
    if (order.status !== 'paid' || order.fulfillmentType !== 'manual') {
      throw new BadRequestException('В работу берут оплаченный заказ, который ещё не выдан');
    }
    if (order.serviceStartedAt) return order;
    const started = await this.prisma.order.update({ where: { id: order.id }, data: { serviceStartedAt: new Date() } });
    await this.notifications.notify(order.buyerId, 'order_started', { orderId: order.id });
    await this.sys(order.id, 'Продавец взял заказ в работу.');
    return started;
  }

  /**
   * Срок услуги вышел, а выдачи нет (часть 125): обе стороны узнают об этом
   * один раз; у покупателя — спор сразу, через сутки без выдачи и спора
   * деньги вернутся сами (refundOverdue из фоновой задачи).
   */
  async markServiceOverdue(orderId: string) {
    const claimed = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'paid', serviceOverdueAt: null },
      data: { serviceOverdueAt: new Date() },
    });
    if (claimed.count === 0) return;
    const order = await this.get(orderId);
    await this.notifications.notify(order.buyerId, 'service_overdue', { orderId, side: 'buyer' });
    await this.notifications.notify(order.sellerId, 'service_overdue', { orderId, side: 'seller' });
    await this.sys(
      order.id,
      'Срок выполнения вышел. Покупатель может открыть спор; без выдачи и спора деньги вернутся покупателю через сутки.',
    );
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

  /**
   * Покупатель подтверждает получение (или система по таймауту). Релиз
   * эскроу — сразу или, если у лота гарантия (часть 126), когда она
   * закончится: в этот срок покупатель ещё может открыть спор.
   */
  async confirm(orderId: string, buyerId: string, opts: { system?: boolean } = {}) {
    const order = await this.get(orderId);
    if (!opts.system && order.buyerId !== buyerId) throw new ForbiddenException('Это не ваш заказ');
    this.assertTransition(order.status, 'completed');

    const days = (order.listingSnapshot as { warrantyDays?: number } | null)?.warrantyDays;
    const until = days ? warrantyUntil(new Date(), days) : null;
    if (!until) await this.releaseSeller(order, 'order_release');

    const [updated] = await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'completed', completedAt: new Date(), warrantyUntil: until },
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
    if (until) {
      // Гарантия: деньги у площадки до её конца, кэшбэк и партнёру — тогда же.
      await this.notifications.notify(order.sellerId, 'warranty_started', { orderId: order.id });
      await this.sys(
        order.id,
        opts.system
          ? 'Срок проверки истёк — заказ подтверждён автоматически. Идёт гарантия продавца: срок — на странице заказа, в этот срок покупатель может открыть спор, деньги до её конца у площадки.'
          : 'Покупатель подтвердил получение. Идёт гарантия продавца: срок — на странице заказа, в этот срок покупатель может открыть спор, деньги до её конца у площадки.',
      );
      return updated;
    }
    await this.notifications.notify(order.sellerId, 'order_completed', { orderId: order.id });
    await this.sys(
      order.id,
      opts.system
        ? 'Срок проверки истёк — заказ подтверждён автоматически. Средства переданы продавцу.'
        : 'Покупатель подтвердил получение. Сделка завершена, средства переданы продавцу.',
    );
    await this.settle(updated);
    return updated;
  }

  /**
   * Гарантия закончилась без спора (часть 126): деньги — продавцу, кэшбэк —
   * покупателю, доля — партнёру. Проводка идемпотентна, повтор безопасен.
   */
  async releaseWarranty(orderId: string) {
    const order = await this.get(orderId);
    if (order.status !== 'completed' || !order.warrantyUntil || order.warrantyReleasedAt) return;
    if (order.warrantyUntil.getTime() > Date.now()) return;
    await this.releaseSeller(order, 'order_release');
    const claimed = await this.prisma.order.updateMany({
      where: { id: order.id, warrantyReleasedAt: null },
      data: { warrantyReleasedAt: new Date() },
    });
    if (claimed.count === 0) return;
    await this.notifications.notify(order.sellerId, 'order_completed', { orderId: order.id });
    await this.sys(order.id, 'Гарантия закончилась — средства переданы продавцу.');
    await this.settle(order);
  }

  /** Деньги продавцу ушли: кэшбэк покупателю и доля партнёру. */
  private async settle(order: Order) {
    // Кэшбэк покупателю на баланс — наш ответ на «токены P» конкурентов (живые деньги).
    // В «Безопасной сделке» (часть 123) — пауза: баланс в ней не потратить, а
    // выплата 20 ₽ на карту стоит дороже самих 20 ₽. Бонусы-скидка — часть 146.
    const cashback = order.dealId ? 0n : cashbackFor(order.amount);
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
    // Партнёру — доля с этой сделки, если её участника привёл он (часть 116).
    // Сбой начисления не отменяет завершённую сделку: продавец уже с деньгами.
    await this.partners.accrue(order).catch((e) => {
      this.logger.warn(`Партнёрское начисление по ${order.id}: ${(e as Error).message}`);
    });
  }

  /**
   * Отмена оплаченного заказа с возвратом исходным способом (часть 137):
   * заказ занимается первым (повтор и параллельная выдача не пройдут), затем
   * шлюз возвращает платёж (`refund` — от PaymentsService), и только после
   * этого проводки. Шлюз отказал — заказ снова оплачен, деньги на месте.
   */
  async cancelToOriginal(orderId: string, buyerId: string, refund: (order: Order) => Promise<void>) {
    const order = await this.get(orderId);
    if (order.buyerId !== buyerId) throw new ForbiddenException('Это не ваш заказ');
    if (order.status !== 'paid') throw new ConflictException('Отменить с возвратом можно оплаченный, ещё не выданный заказ');
    if (order.serviceStartedAt) {
      throw new ConflictException('Продавец уже взял заказ в работу: отменить можно через спор или попросить продавца вернуть деньги');
    }
    if (!canRefundToOriginal(order)) {
      throw new BadRequestException('Этот заказ вернуть на карту нельзя — только на баланс');
    }
    const claimed = await this.prisma.order.updateMany({ where: { id: order.id, status: 'paid' }, data: { status: 'refunded' } });
    if (!claimed.count) throw new ConflictException('Заказ уже выдан или отменён');
    try {
      await refund(order);
    } catch (e) {
      await this.prisma.order.update({ where: { id: order.id }, data: { status: 'paid' } });
      this.logger.warn(`Возврат на карту по ${order.publicNumber}: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Платёжная система не приняла возврат. Попробуйте позже или верните на баланс.');
    }
    await this.ledger.post({
      legs: refundToOriginal(order.amount, order.paymentSurcharge),
      currency: order.currency,
      idempotencyKey: `refund:${order.id}`,
      orderId: order.id,
      refType: 'order_refund_original',
      refId: order.id,
    });
    await this.restock(order);
    await this.notifications.notify(order.buyerId, 'order_refunded', { orderId: order.id, to: 'original' });
    await this.notifications.notify(order.sellerId, 'order_cancelled', { orderId: order.id });
    await this.sys(order.id, 'Заказ отменён, деньги возвращаются тем же способом оплаты — банк зачислит их за 1–10 дней.');
    return this.get(order.id);
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
      // Продавец уже взял заказ в работу (часть 125): покупатель не отменяет
      // его в одиночку — работа могла быть сделана. Спор или возврат продавцом.
      if (order.serviceStartedAt && userId === order.buyerId) {
        throw new ConflictException('Продавец уже взял заказ в работу: отменить можно через спор или попросить продавца вернуть деньги');
      }
      this.assertTransition(order.status, 'refunded');
      await this.refundBuyer(order, 'order_refund');
      const res = await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'refunded' },
      });
      await this.restock(order);
      await this.notifications.notify(order.buyerId, 'order_refunded', { orderId: order.id });
      await this.sys(order.id, `Заказ отменён, средства возвращены покупателю ${this.refundedTo(order)}.`);
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

    await this.refundBuyer(order, 'seller_refund');
    const res = await this.prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } });
    if (wasPaid) await this.restock(order);
    if (wasDisputed) {
      // Не «комментарий арбитра»: решение приняла сторона, об этом — сообщение площадки в споре.
      const closed = await this.prisma.dispute.updateMany({
        where: { orderId: order.id, status: { in: ['open', 'in_review'] } },
        data: { status: 'resolved_buyer', resolvedAt: new Date(), awaitingFrom: null, respondBy: null },
      });
      const dispute = closed.count
        ? await this.prisma.dispute.findUnique({ where: { orderId: order.id }, select: { id: true } })
        : null;
      if (dispute) {
        await this.prisma.disputeMessage.create({
          data: { disputeId: dispute.id, senderId: null, body: DISPUTE_NOTES.refunded },
        });
      }
    }
    await this.notifications.notify(order.buyerId, 'order_refunded', { orderId: order.id, reason: 'seller_refund' });
    // Причину пишет продавец, а системное сообщение не проходит фильтр чата:
    // без маскирования через «причину» уводили бы сделку в мессенджер.
    const why = reason?.trim() ? ` Причина: ${maskContacts(reason.trim()).masked}` : '';
    await this.sys(order.id, `Продавец вернул деньги покупателю ${this.refundedTo(order)}.${why}`);
    return res;
  }

  /** Продавец не выдал товар в срок → системный возврат покупателю (вызывается sweep). */
  async refundOverdue(orderId: string) {
    const order = await this.get(orderId);
    if (order.status !== 'paid') return;
    await this.refundBuyer(order, 'order_refund_overdue');
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
    if (order.status === 'completed') {
      // Завершённый — в спор только по гарантии продавца (часть 126), пока
      // деньги у площадки, и только покупателем.
      if (!warrantyActive(order) || order.buyerId !== userId) {
        throw new ConflictException('Заказ завершён, гарантии по нему нет или она закончилась — спор открыть нельзя');
      }
    } else {
      this.assertTransition(order.status, 'disputed');
    }
    const res = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'disputed' },
    });
    await this.sys(order.id, 'Открыт спор. К обсуждению подключится арбитр площадки.');
    return res;
  }

  /** Разрешение спора арбитром: релиз продавцу или возврат покупателю. Идемпотентно. */
  async applyDisputeResolution(orderId: string, outcome: 'seller' | 'buyer', refundPct = 100) {
    const order = await this.get(orderId);
    if (order.status !== 'disputed') {
      throw new ConflictException('Заказ не в статусе спора');
    }

    // Частичный возврат (часть 140): покупателю его доля, остаток — продавцу
    // и площадке в той же пропорции. В «Безопасной сделке» — только целиком.
    if (outcome === 'buyer' && refundPct < 100 && !order.dealId) {
      const split = disputeSplit(order.amount, order.sellerPayoutAmount, refundPct);
      await this.ledger.post({
        legs: splitEscrow(order.buyerId, order.sellerId, split),
        currency: order.currency,
        idempotencyKey: `split:${order.id}`,
        orderId: order.id,
        refType: 'dispute_split',
        refId: order.id,
      });
      const done = await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'completed',
          completedAt: order.completedAt ?? new Date(),
          ...(order.warrantyUntil ? { warrantyReleasedAt: new Date() } : {}),
        },
      });
      await this.sys(order.id, `Спор решён: покупателю возвращено ${refundPct}% суммы, остаток — продавцу.`);
      return done;
    }

    if (outcome === 'seller') {
      await this.releaseSeller(order, 'dispute_release');
      // Спор по гарантии (часть 126): заказ уже подтверждали — дата та же,
      // деньги переданы сейчас.
      const done = await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'completed',
          completedAt: order.completedAt ?? new Date(),
          ...(order.warrantyUntil ? { warrantyReleasedAt: new Date() } : {}),
        },
      });
      await this.sys(order.id, 'Спор решён в пользу продавца. Средства переданы продавцу.');
      return done;
    }

    await this.refundBuyer(order, 'dispute_refund');
    const refunded = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'refunded' },
    });
    // Спор по гарантии выигран покупателем: подтверждённая продажа не состоялась.
    if (order.completedAt) {
      await this.prisma.$transaction([
        this.prisma.listing.update({ where: { id: order.listingId }, data: { salesCount: { decrement: 1 } } }),
        this.prisma.profile.update({ where: { userId: order.sellerId }, data: { salesCount: { decrement: 1 } } }),
      ]);
    }
    await this.sys(
      order.id,
      order.dealId
        ? 'Спор решён в пользу покупателя. Средства возвращены покупателю на карту.'
        : 'Спор решён в пользу покупателя. Средства возвращены покупателю.',
    );
    return refunded;
  }

  /**
   * Мои заказы: покупки, продажи или всё вместе, с фильтром по статусам.
   * Вторая сторона и название — сразу в ответе: список «Продажи» без них
   * превращался в столбик номеров.
   */
  async listMine(
    userId: string,
    q: { role?: 'buyer' | 'seller'; status?: OrderStatus[]; limit?: number } = {},
  ) {
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
      take: q.limit ?? 200,
      include: WITH_PARTIES,
    });
    return rows.map((o) => this.row(o, userId));
  }

  /**
   * «Заказы» в кабинете: покупки или продажи новыми сверху, по страницам.
   * Поиск — по номеру заказа, названию лота и нику другой стороны; период —
   * последние `days` дней. Дальше — по последнему показанному (`before`):
   * новый заказ, пришедший, пока листаешь, список не сдвигает.
   */
  async history(
    userId: string,
    q: {
      role: 'buyer' | 'seller';
      status?: OrderStatus[];
      q?: string;
      days?: number;
      before?: string;
      limit?: number;
    },
  ) {
    const limit = q.limit ?? 30;
    const mine: Prisma.OrderWhereInput =
      q.role === 'buyer' ? { buyerId: userId } : { sellerId: userId };
    let where: Prisma.OrderWhereInput = { ...mine };
    const since = q.days ? new Date(Date.now() - q.days * 86_400_000) : undefined;
    if (q.status?.length) where.status = { in: q.status };
    if (since) where.createdAt = { gte: since };
    if (q.before) {
      const at = await this.prisma.order.findFirst({
        where: { id: q.before, ...mine },
        select: { id: true, createdAt: true },
      });
      if (!at) throw new BadRequestException('Список заказов устарел — обновите страницу');
      where.AND = [
        { OR: [{ createdAt: { lt: at.createdAt } }, { createdAt: at.createdAt, id: { lt: at.id } }] },
      ];
    }
    // «#GM-…» и «@ник» ищутся как есть, без значка впереди.
    const text = q.q?.trim().replace(/^[#@]+/, '');
    if (text) {
      const ids = await this.searchIds(userId, q.role, text, {
        status: q.status,
        since,
        before: q.before,
        take: limit + 1,
      });
      where = { id: { in: ids } };
    }
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: WITH_PARTIES,
    });
    const items = rows.slice(0, limit).map((o) => this.row(o, userId));
    return { items, next: rows.length > limit ? items[items.length - 1]!.id : null };
  }

  /**
   * Поиск в «Заказах» — по тому, что видно в списке: номер, название лота из
   * самого заказа (лот после покупки могли переименовать или удалить) и ник
   * другой стороны. Одним условием с «или» база перебирала все заказы
   * продавца — на 50 тыс. заказов 150–200 мс на каждый поиск. Здесь у каждой
   * ветки свой триграммный индекс (миграция `orders_search_trgm`) и своя
   * первая страница по времени; объединение — та же страница целиком.
   */
  private async searchIds(
    userId: string,
    role: 'buyer' | 'seller',
    text: string,
    q: { status?: OrderStatus[]; since?: Date; before?: string; take: number },
  ): Promise<string[]> {
    const pattern = `%${likeText(text)}%`;
    const me = role === 'buyer' ? Prisma.sql`o.buyer_id` : Prisma.sql`o.seller_id`;
    const other = role === 'buyer' ? Prisma.sql`o.seller_id` : Prisma.sql`o.buyer_id`;
    const conds = [Prisma.sql`${me} = ${userId}::uuid`];
    if (q.status?.length) conds.push(Prisma.sql`o.status::text = ANY(${q.status}::text[])`);
    // Время в базе — UTC без пояса; пояс соединения на сравнение не влияет.
    if (q.since) {
      conds.push(Prisma.sql`o.created_at >= (${q.since.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
    }
    if (q.before) {
      conds.push(
        Prisma.sql`(o.created_at, o.id) < (SELECT c.created_at, c.id FROM orders c WHERE c.id = ${q.before}::uuid)`,
      );
    }
    const base = Prisma.join(conds, ' AND ');
    const page = Prisma.sql`ORDER BY o.created_at DESC, o.id DESC LIMIT ${q.take}`;
    const query = Prisma.sql`
      SELECT id FROM (
        (SELECT o.id, o.created_at FROM orders o
          WHERE ${base} AND o.public_number ILIKE ${pattern} ${page})
        UNION
        (SELECT o.id, o.created_at FROM orders o
          WHERE ${base} AND (o.listing_snapshot ->> 'title') ILIKE ${pattern} ${page})
        UNION
        (SELECT o.id, o.created_at FROM orders o JOIN profiles p ON p.user_id = ${other}
          WHERE ${base} AND p.username ILIKE ${pattern} ${page})
      ) t
      ORDER BY created_at DESC, id DESC LIMIT ${q.take}`;
    // Какой индекс выгоднее, решает сам текст поиска. С шестого вызова база
    // берёт общий план подготовленного запроса, а он текста не видит и
    // перебирает заказы по нику (на 50 тыс. — 27 мс вместо 0,5). Поэтому
    // только здесь, в своей транзакции, план строится под каждый поиск.
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('plan_cache_mode', 'force_custom_plan', true)`;
      return tx.$queryRaw<Array<{ id: string }>>(query);
    });
    return rows.map((r) => r.id);
  }

  /** Строка списка заказов: своя роль, ник другой стороны, лот из снимка. */
  private row(
    { buyer, seller, ...o }: Order & { buyer: PartyName; seller: PartyName },
    userId: string,
  ) {
    const asBuyer = o.buyerId === userId;
    return {
      ...o,
      role: asBuyer ? ('buyer' as const) : ('seller' as const),
      counterparty: (asBuyer ? seller : buyer).profile?.username ?? null,
      title: (o.listingSnapshot as { title?: string } | null)?.title ?? null,
      unitName: (o.listingSnapshot as { unitName?: string } | null)?.unitName ?? null,
    };
  }

  /**
   * Заказ для его страницы — с id диалога сделки. Раньше страница искала
   * диалог в списке мессенджера, а тот обрезан: у продавца с тысячами
   * заказов в старом заказе чата не было вовсе.
   */
  async getForUser(orderId: string, userId: string) {
    const found = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { conversation: { select: { id: true } } },
    });
    if (!found) throw new NotFoundException('Заказ не найден');
    if (found.buyerId !== userId && found.sellerId !== userId) {
      throw new ForbiddenException('Нет доступа к заказу');
    }
    const { conversation, ...order } = found;
    return { ...order, conversationId: conversation?.id ?? null };
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
