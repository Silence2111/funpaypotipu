import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RetentionModule } from '../retention/retention.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { ConsentService } from './consent.service';
import { DeletionService } from './deletion.service';
import { ExportService } from './export.service';

@Module({
  imports: [AuthModule, RetentionModule],
  controllers: [AccountController],
  providers: [ExportService, AccountService, ConsentService, DeletionService],
})
export class AccountModule {}
