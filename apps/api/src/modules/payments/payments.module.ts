import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { SafeDealModule } from '../safe-deal/safe-deal.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { MockPaymentProvider } from './mock.provider';
import { PaymentProviderRegistry } from './provider.registry';
import { YooKassaProvider } from './yookassa.provider';

@Module({
  imports: [AuthModule, OrdersModule, SafeDealModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, MockPaymentProvider, YooKassaProvider, PaymentProviderRegistry],
})
export class PaymentsModule {}
