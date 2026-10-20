import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { RateLimit } from '../../common/rate-limit';

const createReviewSchema = z.object({
  orderId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});
const replySchema = z.object({ text: z.string().min(1).max(2000) });
const listQuerySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const updateReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => v.rating !== undefined || v.comment !== undefined, 'Нечего менять');

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('user/:userId')
  forUser(
    @Param('userId') userId: string,
    @Query(new ZodValidationPipe(listQuerySchema)) q: { rating?: number; page: number; limit: number },
  ) {
    return this.reviews.listForUser(userId, q);
  }

  @Post()
  @RateLimit('reviews', 30, 3600)
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createReviewSchema))
    body: { orderId: string; rating: number; comment?: string },
  ) {
    return this.reviews.create(body.orderId, user.userId, body.rating, body.comment);
  }

  @Get('by-order/:orderId')
  @UseGuards(JwtAuthGuard)
  byOrder(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.reviews.forOrder(orderId, user.userId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateReviewSchema)) body: { rating?: number; comment?: string | null },
  ) {
    return this.reviews.update(id, user.userId, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reviews.remove(id, user.userId);
  }

  @Post(':id/reply')
  @UseGuards(JwtAuthGuard)
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(replySchema)) body: { text: string },
  ) {
    return this.reviews.reply(id, user.userId, body.text);
  }
}
