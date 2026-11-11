import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { PrismaClient, type ListingStatus, type OrderStatus } from '@gamemarket/db';
import { API_STOCK_MAX } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AccountStatusService } from '../access/account-status.service';
import { ListingsService } from '../listings/listings.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrdersService } from '../orders/orders.service';
import { ChatService } from '../chat/chat.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyGuard, type ApiUser } from './api-key.guard';

type ApiReq = Request & { apiUser: ApiUser };

const LISTING_STATUSES = ['active', 'paused', 'sold_out', 'review', 'blocked', 'draft'] as const;
const ORDER_STATUSES = ['created', 'paid', 'delivered', 'completed', 'disputed', 'refunded', 'cancelled', 'expired'] as const;

const listingsQuery = z.object({
  status: z.enum(LISTING_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});
const listingPatch = z
  .object({
    // Копейки строкой, как в остальном API: 49000 — это 490 ₽.
    price: z.string().regex(/^\d{1,12}$/, 'Цена — целое число копеек, например 49000').optional(),
    stock: z.number().int().min(0).max(1_000_000).nullable().optional(),
    status: z.enum(['active', 'paused']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Нечего менять: price, stock или status');
const stockBody = z.object({
  items: z.array(z.string().trim().min(1).max(2000)).min(1).max(API_STOCK_MAX, `Не больше ${API_STOCK_MAX} строк за раз`),
});
const ordersQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const deliverBody = z.object({ message: z.string().trim().min(1).max(2000).optional() });

/**
 * Открытое API продавца (часть 127), `/api/v1/*` по ключу: свои лоты —
 * цена, наличие, снять и вернуть; склад автовыдачи; продажи и отметка
 * выдачи с сообщением покупателю. Правила те же, что на сайте: закрытый
 * раздел, лот на проверке, заморозка аккаунта — те же ответы.
 */
@Controller('v1')
@UseGuards(ApiKeyGuard)
export class SellerApiController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly account: AccountStatusService,
    private readonly listings: ListingsService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
    private readonly chat: ChatService,
  ) {}

  @Get('me')
  async me(@Req() req: ApiReq) {
    const p = await this.prisma.profile.findUnique({
      where: { userId: req.apiUser.userId },
      select: { username: true, ratingAvg: true, ratingCount: true, salesCount: true },
    });
    return { id: req.apiUser.userId, ...p };
  }

  @Get('listings')
  async listListings(@Req() req: ApiReq, @Query(new ZodValidationPipe(listingsQuery)) q: z.infer<typeof listingsQuery>) {
    const rows = await this.prisma.listing.findMany({
      where: {
        sellerId: req.apiUser.userId,
        status: q.status ? (q.status as ListingStatus) : { not: 'archived' },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        price: true,
        currency: true,
        stock: true,
        status: true,
        fulfillmentType: true,
        createdAt: true,
        game: { select: { slug: true, title: true } },
        category: { select: { slug: true, title: true } },
      },
    });
    const items = rows.slice(0, q.limit).map((l) => ({ ...l, price: l.price.toString(), autoDelivery: l.fulfillmentType === 'auto_key' }));
    return { items, next: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  @Patch('listings/:id')
  async patchListing(
    @Req() req: ApiReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(listingPatch)) body: z.infer<typeof listingPatch>,
  ) {
    if (body.status === 'active') await this.account.assertCanTrade(req.apiUser.userId);
    const updated = await this.listings.update(req.apiUser.userId, id, body);
    return { id: updated.id, price: updated.price.toString(), stock: updated.stock, status: updated.status };
  }

  /** Склад автовыдачи: строки товара или ключи; повторы и уже выданное пропускаются. */
  @Post('listings/:id/stock')
  @HttpCode(200)
  async addStock(
    @Req() req: ApiReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(stockBody)) body: z.infer<typeof stockBody>,
  ) {
    await this.account.assertCanTrade(req.apiUser.userId);
    return this.inventory.addKeys(req.apiUser.userId, id, body.items);
  }

  @Get('orders')
  async listOrders(@Req() req: ApiReq, @Query(new ZodValidationPipe(ordersQuery)) q: z.infer<typeof ordersQuery>) {
    const rows = await this.prisma.order.findMany({
      where: {
        sellerId: req.apiUser.userId,
        ...(q.status ? { status: q.status as OrderStatus } : {}),
        ...(q.since ? { updatedAt: { gte: q.since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      select: {
        id: true,
        publicNumber: true,
        status: true,
        listingId: true,
        listingSnapshot: true,
        qty: true,
        amount: true,
        sellerPayoutAmount: true,
        currency: true,
        createdAt: true,
        paidAt: true,
        deliveredAt: true,
        buyer: { select: { profile: { select: { username: true } } } },
      },
    });
    return {
      items: rows.map((o) => {
        const snap = (o.listingSnapshot ?? {}) as { title?: string; buyerData?: unknown; account?: string };
        return {
          id: o.id,
          publicNumber: o.publicNumber,
          status: o.status,
          listingId: o.listingId,
          title: snap.title ?? null,
          qty: o.qty,
          amount: o.amount.toString(),
          sellerPayout: o.sellerPayoutAmount.toString(),
          currency: o.currency,
          buyer: o.buyer.profile?.username ?? null,
          // Ответы покупателя на поля лота (ник, сервер) — без них не выдать.
          buyerData: snap.buyerData ?? [],
          createdAt: o.createdAt,
          paidAt: o.paidAt,
          deliveredAt: o.deliveredAt,
        };
      }),
    };
  }

  /** Отметить выдачу; сообщение — покупателю в чат заказа (контакты скрываются, как в чате). */
  @Post('orders/:id/deliver')
  @HttpCode(200)
  async deliver(
    @Req() req: ApiReq,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(deliverBody)) body: z.infer<typeof deliverBody>,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id }, select: { sellerId: true } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.sellerId !== req.apiUser.userId) throw new ForbiddenException('Это не ваш заказ');
    if (body.message) {
      const conv = await this.prisma.conversation.findFirst({ where: { orderId: id }, select: { id: true } });
      if (conv) await this.chat.sendMessage(conv.id, req.apiUser.userId, body.message);
    }
    const res = await this.orders.markDelivered(id, req.apiUser.userId);
    return { id: res.id, status: res.status, deliveredAt: res.deliveredAt };
  }
}

const keyBody = z.object({ name: z.string().trim().min(1, 'Назовите ключ — например, «бот склада»').max(60) });
const webhookBody = z.object({ url: z.string().trim().min(8).max(500) });

/** Ключи, вебхук и журнал API — в кабинете продавца (вход на сайт, не ключ). */
@Controller('account/api')
@UseGuards(JwtAuthGuard)
export class SellerApiCabinetController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Get('keys')
  list(@CurrentUser() u: AuthUser) {
    return this.keys.list(u.userId);
  }

  @Post('keys')
  @RateLimit('api-keys', 20, 3600)
  create(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(keyBody)) body: z.infer<typeof keyBody>) {
    return this.keys.create(u.userId, body.name);
  }

  @Delete('keys/:id')
  revoke(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.keys.revoke(u.userId, id);
  }

  @Get('requests')
  requests(@CurrentUser() u: AuthUser) {
    return this.keys.requests(u.userId);
  }

  @Get('webhook')
  webhook(@CurrentUser() u: AuthUser) {
    return this.webhooks.get(u.userId);
  }

  @Put('webhook')
  @RateLimit('api-webhook', 20, 3600)
  setWebhook(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(webhookBody)) body: z.infer<typeof webhookBody>) {
    return this.webhooks.set(u.userId, body.url);
  }

  @Delete('webhook')
  removeWebhook(@CurrentUser() u: AuthUser) {
    return this.webhooks.remove(u.userId);
  }

  @Post('webhook/test')
  @HttpCode(200)
  @RateLimit('api-webhook-test', 30, 3600)
  testWebhook(@CurrentUser() u: AuthUser) {
    return this.webhooks.test(u.userId);
  }
}
