import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { BuyerReviewsController } from './buyer-reviews.controller';
import { BuyerReviewsService } from './buyer-reviews.service';

@Module({
  imports: [AuthModule],
  controllers: [ReviewsController, BuyerReviewsController],
  providers: [ReviewsService, BuyerReviewsService],
  exports: [BuyerReviewsService],
})
export class ReviewsModule {}
