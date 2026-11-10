import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { ConsentService } from './consent.service';

@Module({
  imports: [AuthModule],
  controllers: [AccountController],
  providers: [AccountService, ConsentService],
})
export class AccountModule {}
