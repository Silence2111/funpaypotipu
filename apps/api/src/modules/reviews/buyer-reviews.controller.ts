import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BuyerReviewsService } from './buyer-reviews.service';

const rateSchema = z.object({
  good: z.boolean(),
  comment: z.string().max(300, 'Комментарий — до 300 знаков').nullable().optional(),
});

/** Оценка покупателя в заказе: продавец ставит, обе стороны видят. */
@Controller('orders/:orderId/buyer-review')
@UseGuards(JwtAuthGuard)
export class BuyerReviewsController {
  constructor(private readonly reviews: BuyerReviewsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.reviews.forOrder(orderId, user.userId);
  }

  @Put()
  rate(
    @CurrentUser() user: AuthUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body(new ZodValidationPipe(rateSchema)) body: z.infer<typeof rateSchema>,
  ) {
    return this.reviews.rate(orderId, user.userId, body);
  }

  @Delete()
  remove(@CurrentUser() user: AuthUser, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.reviews.remove(orderId, user.userId);
  }
}
