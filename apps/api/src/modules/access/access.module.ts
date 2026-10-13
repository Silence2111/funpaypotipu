import { Global, Module } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { AuditService } from './audit.service';
import { AccountStatusService } from './account-status.service';

@Global()
@Module({
  providers: [RolesGuard, AuditService, AccountStatusService],
  exports: [RolesGuard, AuditService, AccountStatusService],
})
export class AccessModule {}
