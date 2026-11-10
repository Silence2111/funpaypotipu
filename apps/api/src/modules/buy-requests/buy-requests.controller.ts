import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { BUY_REQUEST_TEXT_MAX, BUY_REQUEST_TEXT_MIN } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimit } from '../../common/rate-limit';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BuyRequestsService, type RequestInput } from './buy-requests.service';

const createSchema = z.object({
  categoryId: z.string().uuid(),
  text: z
    .string()
    .trim()
    .min(BUY_REQUEST_TEXT_MIN, 'Опишите, что ищете, — от 10 символов')
    .max(BUY_REQUEST_TEXT_MAX, 'Запрос — до 300 символов'),
  /** Копейки, до 10 млн ₽ — как цена лота. */
  maxPrice: z.number().int().positive('Цена — больше нуля').max(1_000_000_000, 'Цена — до 10 млн ₽').nullish(),
});
const categoryQuery = z.object({
  categoryId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const sellerQuery = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  r: z.string().uuid().optional(),
});
const offerSchema = z.object({ listingId: z.string().uuid() });

/** Запросы покупателей «Хочу купить» (часть 115). */
@Controller('buy-requests')
export class BuyRequestsController {
  constructor(private readonly requests: BuyRequestsService) {}

  /** Открытые запросы раздела — без входа: спрос виден и тем, кто ещё не продаёт. */
  @Get()
  inCategory(@Query(new ZodValidationPipe(categoryQuery)) q: z.infer<typeof categoryQuery>) {
    return this.requests.inCategory(q.categoryId, q.limit);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.requests.mine(user.userId);
  }

  /** Продавцу: запросы в его разделах или во всех. */
  @Get('for-seller')
  @UseGuards(JwtAuthGuard)
  forSeller(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(sellerQuery)) q: z.infer<typeof sellerQuery>) {
    return this.requests.forSeller(user.userId, q.scope, q.r);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @RateLimit('buy-requests', 20, 3600)
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createSchema)) body: RequestInput) {
    return this.requests.create(user.userId, body);
  }

  @Post(':id/close')
  @UseGuards(JwtAuthGuard)
  close(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.close(user.userId, id);
  }

  @Get(':id/candidates')
  @UseGuards(JwtAuthGuard)
  candidates(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.candidates(user.userId, id);
  }

  @Post(':id/offers')
  @UseGuards(JwtAuthGuard)
  @RateLimit('buy-request-offers', 60, 3600)
  offer(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(offerSchema)) body: { listingId: string },
  ) {
    return this.requests.offer(user.userId, id, body.listingId);
  }
}
