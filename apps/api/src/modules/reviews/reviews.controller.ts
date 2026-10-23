import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  // Фото — ключи из POST /reviews/uploads.
  images: z.array(z.string().max(200)).max(5).optional(),
});
const replySchema = z.object({ text: z.string().min(1).max(2000) });
const listQuerySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  // Только отзывы с фото.
  photos: z
    .enum(['1', 'true'])
    .optional()
    .transform((v) => !!v),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const updateReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().max(2000).nullable().optional(),
    images: z.array(z.string().max(200)).max(5).optional(),
  })
  .refine(
    (v) => v.rating !== undefined || v.comment !== undefined || v.images !== undefined,
    'Нечего менять',
  );

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('user/:userId')
  forUser(
    @Param('userId') userId: string,
    @Query(new ZodValidationPipe(listQuerySchema))
    q: { rating?: number; photos: boolean; page: number; limit: number },
  ) {
    return this.reviews.listForUser(userId, q);
  }

  @Post()
  @RateLimit('reviews', 30, 3600)
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createReviewSchema))
    body: { orderId: string; rating: number; comment?: string; images?: string[] },
  ) {
    return this.reviews.create(body.orderId, user.userId, body.rating, body.comment, body.images);
  }

  /** Фото к отзыву (multipart, поле file) — ключ потом уходит в отзыв. */
  @Post('uploads')
  @RateLimit('uploads', 30, 600)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    return this.reviews.uploadImage(user.userId, file);
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
    @Body(new ZodValidationPipe(updateReviewSchema))
    body: { rating?: number; comment?: string | null; images?: string[] },
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
