import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { ConsentService } from './consent.service';
import { DeletionService } from './deletion.service';

@Module({
  imports: [AuthModule],
  controllers: [AccountController],
  providers: [AccountService, ConsentService, DeletionService],
})
export class AccountModule {}
