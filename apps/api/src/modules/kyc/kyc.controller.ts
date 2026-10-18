import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { KycService } from './kyc.service';

const uploadSchema = z.object({ mime: z.string().min(3).max(100) });
const key = z.string().min(3).max(200);
// Документ — разворот и, если нужно, второе фото; селфи — с документом в руке.
const submitSchema = z.object({
  documentKeys: z.array(key).min(1, 'Добавьте фото документа').max(2, 'Документ — до двух фото'),
  selfieKey: key,
});
const reviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(300).optional(),
});

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
    @Body(new ZodValidationPipe(submitSchema)) body: { documentKeys: string[]; selfieKey: string },
  ) {
    return this.kyc.submit(user.userId, body.documentKeys, body.selfieKey);
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
    @Body(new ZodValidationPipe(reviewSchema))
    body: { decision: 'approve' | 'reject'; reason?: string },
  ) {
    return this.kyc.review(id, user.userId, body.decision, body.reason);
  }
}
