import { Global, Module } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { AuditService } from './audit.service';
import { AccountStatusService } from './account-status.service';
import { BlocksService } from './blocks.service';

@Global()
@Module({
  providers: [RolesGuard, AuditService, AccountStatusService, BlocksService],
  exports: [RolesGuard, AuditService, AccountStatusService, BlocksService],
})
export class AccessModule {}
