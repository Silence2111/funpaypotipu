import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockWatchesController } from './stock-watches.controller';
import { StockWatchesService } from './stock-watches.service';

@Module({
  imports: [AuthModule],
  controllers: [StockWatchesController],
  providers: [StockWatchesService],
})
export class StockWatchesModule {}
