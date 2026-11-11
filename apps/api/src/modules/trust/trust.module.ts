import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AntifraudController, TrustController } from './trust.controller';
import { TrustService } from './trust.service';
import { AntifraudService } from './antifraud.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [TrustController, AntifraudController],
  providers: [TrustService, AntifraudService],
  exports: [TrustService, AntifraudService],
})
export class TrustModule {}
