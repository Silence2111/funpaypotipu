import { Global, Module } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [RolesGuard, AuditService],
  exports: [RolesGuard, AuditService],
})
export class AccessModule {}
