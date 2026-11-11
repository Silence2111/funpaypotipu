import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { DisputeSettingsController, DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [DisputesController, DisputeSettingsController],
  providers: [DisputesService],
})
export class DisputesModule {}
