import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RecoveryController } from './recovery.controller';
import { RecoveryService } from './recovery.service';
import { YooKassaProvider } from '../payments/yookassa.provider';

@Module({
  imports: [AuthModule],
  controllers: [RecoveryController],
  providers: [RecoveryService, YooKassaProvider],
})
export class RecoveryModule {}
