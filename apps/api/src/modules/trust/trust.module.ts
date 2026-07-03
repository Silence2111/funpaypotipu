import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TrustController } from './trust.controller';
import { TrustService } from './trust.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [TrustController],
  providers: [TrustService],
  exports: [TrustService],
})
export class TrustModule {}
