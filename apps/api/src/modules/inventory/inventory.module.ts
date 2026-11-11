import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  // API продавцов (часть 127) пополняет склад тем же путём, что сайт.
  exports: [InventoryService],
})
export class InventoryModule {}
