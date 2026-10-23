import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ORDER_STATUS, type OrderStatus } from '@gamemarket/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AccountStatusService } from '../access/account-status.service';
import { BlocksService } from '../access/blocks.service';
import { OrdersService } from './orders.service';

const createOrderSchema = z.object({
  listingId: z.string().uuid(),
  promoCode: z.string().min(3).max(32).optional(),
  account: z.string().max(120).optional(), // игровой UID/логин для пополнений (provider)
  // Сколько зачислить — у лота «на сумму покупателя»; минорные единицы строкой.
  topupAmount: z.string().regex(/^\d{1,12}$/).optional(),
  // Сколько единиц — у лота поштучно (валюта, предметы, ключи).
  qty: z.number().int().positive().optional(),
  // Ответы на поля лота «что спросить у покупателя»: { «Ник в игре»: «Dragon_77» }.
  buyerData: z.record(z.string().max(200)).optional(),
});
type CreateOrderBody = z.infer<typeof createOrderSchema>;

const mineQuery = z.object({
  role: z.enum(['buyer', 'seller']).optional(),
  // ?status=paid,delivered
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(ORDER_STATUS))),
});

const refundSchema = z.object({ reason: z.string().max(300).optional() });

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly account: AccountStatusService,
    private readonly blocks: BlocksService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderBody,
  ) {
    await this.account.assertCanTrade(user.userId);
    await this.blocks.assertCanBuy(user.userId, body.listingId);
    const { listingId, ...opts } = body;
    return this.orders.create(user.userId, listingId, opts);
  }

  @Get('mine')
  mine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(mineQuery)) q: { role?: 'buyer' | 'seller'; status: OrderStatus[] },
  ) {
    return this.orders.listMine(user.userId, q);
  }

  @Get(':id')
  byId(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.getForUser(id, user.userId);
  }

  @Get(':id/key')
  key(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.revealKey(id, user.userId);
  }

  @Post(':id/pay-from-balance')
  payFromBalance(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.payFromBalance(id, user.userId);
  }

  @Post(':id/deliver')
  deliver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.markDelivered(id, user.userId);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.confirm(id, user.userId);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.cancel(id, user.userId);
  }

  /** Продавец возвращает деньги покупателю — до подтверждения, в том числе после выдачи. */
  @Post(':id/refund')
  refund(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(refundSchema)) body: { reason?: string },
  ) {
    return this.orders.refundBySeller(id, user.userId, body.reason);
  }
}
