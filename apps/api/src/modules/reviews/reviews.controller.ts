import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ReviewsService } from './reviews.service';

const createReviewSchema = z.object({
  orderId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});
const replySchema = z.object({ text: z.string().min(1).max(2000) });

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('user/:userId')
  forUser(@Param('userId') userId: string) {
    return this.reviews.listForUser(userId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createReviewSchema))
    body: { orderId: string; rating: number; comment?: string },
  ) {
    return this.reviews.create(body.orderId, user.userId, body.rating, body.comment);
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
