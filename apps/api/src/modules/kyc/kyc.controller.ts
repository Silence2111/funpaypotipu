import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { KycLevel } from '@gamemarket/db';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { KycService } from './kyc.service';

const uploadSchema = z.object({ mime: z.string().min(3).max(100) });
const submitSchema = z.object({
  level: z.enum(['phone', 'document']),
  documentKeys: z.array(z.string().min(3)).min(1).max(10),
});
const reviewSchema = z.object({ decision: z.enum(['approve', 'reject']) });

@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  upload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(uploadSchema)) body: { mime: string },
  ) {
    return this.kyc.requestUpload(user.userId, body.mime);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  submit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(submitSchema)) body: { level: KycLevel; documentKeys: string[] },
  ) {
    return this.kyc.submit(user.userId, body.level, body.documentKeys);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.kyc.mine(user.userId);
  }

  // ── Модератор ──
  @Get('pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('moderator')
  pending() {
    return this.kyc.pending();
  }

  @Post(':id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('moderator')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewSchema)) body: { decision: 'approve' | 'reject' },
  ) {
    return this.kyc.review(id, user.userId, body.decision);
  }
}
