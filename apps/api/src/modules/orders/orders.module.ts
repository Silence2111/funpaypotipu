import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { FeesService } from './fees.service';
import { FulfillmentService } from './fulfillment.service';
import { MockTopUpProvider } from './topup.provider';
import { OrdersSweepService } from './orders-sweep.service';

@Module({
  imports: [AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService, FeesService, FulfillmentService, MockTopUpProvider, OrdersSweepService],
  exports: [OrdersService],
})
export class OrdersModule {}
