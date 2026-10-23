import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';
import { SellerPromosController } from './seller-promos.controller';
import { SellerPromosService } from './seller-promos.service';

@Module({
  imports: [AuthModule],
  controllers: [PromoController, SellerPromosController],
  providers: [PromoService, SellerPromosService],
  exports: [PromoService, SellerPromosService],
})
export class PromoModule {}
