import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LotStatsController } from './lot-stats.controller';
import { LotStatsService } from './lot-stats.service';

@Module({
  imports: [AuthModule],
  controllers: [LotStatsController],
  providers: [LotStatsService],
})
export class LotStatsModule {}
