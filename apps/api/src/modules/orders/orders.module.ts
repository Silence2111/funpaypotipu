import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromoModule } from '../promo/promo.module';
import { ChatModule } from '../chat/chat.module';
import { OrdersController } from './orders.controller';
import { FeesController } from './fees.controller';
import { OrdersService } from './orders.service';
import { FeesService } from './fees.service';
import { FulfillmentService } from './fulfillment.service';
import { MockTopUpProvider } from './topup.provider';
import { OrdersSweepService } from './orders-sweep.service';

@Module({
  imports: [AuthModule, PromoModule, ChatModule],
  controllers: [OrdersController, FeesController],
  providers: [OrdersService, FeesService, FulfillmentService, MockTopUpProvider, OrdersSweepService],
  exports: [OrdersService],
})
export class OrdersModule {}
