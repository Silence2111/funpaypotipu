import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListingsModule } from '../listings/listings.module';
import { SellerToolsController } from './seller-tools.controller';
import { SellerToolsService } from './seller-tools.service';

@Module({
  imports: [AuthModule, ListingsModule],
  controllers: [SellerToolsController],
  providers: [SellerToolsService],
})
export class SellerToolsModule {}
