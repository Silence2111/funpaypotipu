import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { ListingStatus, ReportStatus, UserStatus } from '@gamemarket/db';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { ModerationService } from './moderation.service';

const reportSchema = z.object({
  targetType: z.enum(['listing', 'user', 'message']),
  targetId: z.string().min(1),
  reason: z.string().min(3).max(500),
  details: z.string().max(2000).optional(),
});

@Controller()
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  // Любой авторизованный — подать жалобу
  @Post('reports')
  report(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(reportSchema))
    body: { targetType: string; targetId: string; reason: string; details?: string },
  ) {
    return this.moderation.createReport(user.userId, body.targetType, body.targetId, body.reason, body.details);
  }

  // ── Модератор ──
  @Get('moderation/reports')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  reports(@Query('status') status?: ReportStatus) {
    return this.moderation.listReports(status);
  }

  @Post('moderation/reports/:id/handle')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  handle(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ status: z.enum(['reviewing', 'resolved', 'rejected']) })))
    body: { status: ReportStatus },
  ) {
    return this.moderation.handleReport(id, user.userId, body.status);
  }

  @Post('moderation/listings/:id/status')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  listingStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ status: z.enum(['active', 'blocked']), reason: z.string().optional() })))
    body: { status: ListingStatus; reason?: string },
  ) {
    return this.moderation.setListingStatus(user.userId, id, body.status, body.reason);
  }

  @Post('moderation/users/:id/status')
  @UseGuards(RolesGuard)
  @Roles('moderator')
  userStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ status: z.enum(['active', 'frozen', 'banned']), reason: z.string().optional() })))
    body: { status: UserStatus; reason?: string },
  ) {
    return this.moderation.setUserStatus(user.userId, id, body.status, body.reason);
  }
}
