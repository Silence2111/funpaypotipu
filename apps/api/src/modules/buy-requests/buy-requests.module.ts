import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BuyRequestsController } from './buy-requests.controller';
import { BuyRequestsService } from './buy-requests.service';

@Module({
  imports: [AuthModule],
  controllers: [BuyRequestsController],
  providers: [BuyRequestsService],
})
export class BuyRequestsModule {}
