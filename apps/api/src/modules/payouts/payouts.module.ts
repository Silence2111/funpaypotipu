import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { YooKassaPayouts } from './yookassa-payouts';

@Module({
  imports: [AuthModule],
  controllers: [PayoutsController],
  providers: [PayoutsService, YooKassaPayouts],
})
export class PayoutsModule {}
