import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListingsModule } from '../listings/listings.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { ChatModule } from '../chat/chat.module';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyGuard } from './api-key.guard';
import { SellerApiCabinetController, SellerApiController } from './seller-api.controller';

/** API для продавцов (часть 127): /api/v1 по ключу и ключи с вебхуком в кабинете. */
@Module({
  imports: [AuthModule, ListingsModule, InventoryModule, OrdersModule, ChatModule],
  controllers: [SellerApiController, SellerApiCabinetController],
  providers: [ApiKeysService, ApiKeyGuard],
})
export class SellerApiModule {}
