import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SafeDealService } from './safe-deal.service';
import { SafeDealController } from './safe-deal.controller';
import { MockDealGateway, YooKassaDealGateway } from './deal.gateway';

@Module({
  imports: [AuthModule],
  controllers: [SafeDealController],
  providers: [SafeDealService, MockDealGateway, YooKassaDealGateway],
  exports: [SafeDealService],
})
export class SafeDealModule {}
