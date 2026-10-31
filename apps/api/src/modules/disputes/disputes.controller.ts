import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { DisputesService } from './disputes.service';
import { RateLimit } from '../../common/rate-limit';

const openSchema = z.object({ orderId: z.string().uuid(), reason: z.string().min(3).max(2000) });
const attachmentSchema = z.object({
  key: z.string().max(300),
  mime: z.string().max(120),
  size: z.number().int().nonnegative(),
});
const messageSchema = z.object({
  body: z.string().max(4000).default(''),
  internal: z.boolean().optional(),
  attachments: z.array(attachmentSchema).max(6).optional(),
});
const uploadSchema = z.object({ mime: z.string().min(3).max(120) });
const requestSchema = z.object({ side: z.enum(['buyer', 'seller']) });
const resolveSchema = z.object({
  outcome: z.enum(['seller', 'buyer']),
  note: z.string().max(2000).optional(),
});

@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  open(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(openSchema)) body: { orderId: string; reason: string },
  ) {
    return this.disputes.open(body.orderId, user.userId, body.reason);
  }

  @Get('queue')
  @UseGuards(RolesGuard)
  @Roles('agent')
  queue() {
    return this.disputes.queue();
  }

  /** Свои споры: ?state=open (по умолчанию) или closed; дальше — ?before=<id>&limit=30. */
  @Get('mine')
  mine(
    @CurrentUser() user: AuthUser,
    @Query('state') state?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.disputes.mine(user.userId, state === 'closed' ? 'closed' : 'open', {
      before: before || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('by-order/:orderId')
  byOrder(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.disputes.findByOrder(orderId, user.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.disputes.getForUser(id, user.userId);
  }

  @Post(':id/uploads')
  @RateLimit('uploads', 30, 600)
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(uploadSchema)) body: { mime: string },
  ) {
    return this.disputes.requestUpload(id, user.userId, body.mime);
  }

  @Post(':id/messages')
  message(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(messageSchema))
    body: { body: string; internal?: boolean; attachments?: { key: string; mime: string; size: number }[] },
  ) {
    return this.disputes.addMessage(id, user.userId, body.body, body.internal ?? false, body.attachments ?? []);
  }

  @Post(':id/take')
  @UseGuards(RolesGuard)
  @Roles('agent')
  take(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.disputes.take(id, user.userId);
  }

  /** Арбитр просит пояснений у стороны — с новым сроком ответа. */
  @Post(':id/request')
  @UseGuards(RolesGuard)
  @Roles('agent')
  request(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(requestSchema)) body: { side: 'buyer' | 'seller' },
  ) {
    return this.disputes.request(id, user.userId, body.side);
  }

  /** Покупатель закрывает спор: претензий нет, деньги — продавцу. */
  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.disputes.withdraw(id, user.userId);
  }

  @Post(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles('agent')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveSchema)) body: { outcome: 'seller' | 'buyer'; note?: string },
  ) {
    return this.disputes.resolve(id, user.userId, body.outcome, body.note);
  }
}
