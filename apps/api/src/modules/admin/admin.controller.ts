import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { AdminService, type FeeRuleInput } from './admin.service';

const feeRuleSchema = z.object({
  scope: z.enum(['global', 'category', 'seller_tier']),
  scopeRef: z.string().optional(),
  feeBuyerPct: z.number().min(0).max(1),
  feeSellerPct: z.number().min(0).max(1),
  feeFixed: z.number().int().nonnegative().optional(),
  currency: z.string().length(3),
  priority: z.number().int().optional(),
  active: z.boolean().optional(),
});
const roleSchema = z.object({ roleKey: z.string().min(2) });

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users() {
    return this.admin.listUsers();
  }

  @Get('fee-rules')
  feeRules() {
    return this.admin.listFeeRules();
  }

  @Post('fee-rules')
  createFee(@Body(new ZodValidationPipe(feeRuleSchema)) body: FeeRuleInput) {
    return this.admin.createFeeRule(body);
  }

  @Patch('fee-rules/:id')
  updateFee(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(feeRuleSchema.partial())) body: Partial<FeeRuleInput>,
  ) {
    return this.admin.updateFeeRule(id, body);
  }

  @Post('users/:id/roles')
  assignRole(
    @CurrentUser() actor: AuthUser,
    @Param('id') userId: string,
    @Body(new ZodValidationPipe(roleSchema)) body: { roleKey: string },
  ) {
    return this.admin.assignRole(actor.userId, userId, body.roleKey);
  }

  @Post('users/:id/roles/revoke')
  revokeRole(
    @CurrentUser() actor: AuthUser,
    @Param('id') userId: string,
    @Body(new ZodValidationPipe(roleSchema)) body: { roleKey: string },
  ) {
    return this.admin.revokeRole(actor.userId, userId, body.roleKey);
  }
}
