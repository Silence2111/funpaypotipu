import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FollowsService } from './follows.service';

const notifySchema = z.object({ notify: z.boolean() });
const feedSchema = z.object({
  tab: z.enum(['new', 'sale']).default('new'),
  page: z.coerce.number().int().positive().max(50).default(1),
});

@Controller('follows')
@UseGuards(JwtAuthGuard)
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  /** «Мои подписки». */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.follows.list(user.userId);
  }

  /** Лента: новые лоты или идущие скидки продавцов из подписок (перед :sellerId). */
  @Get('feed')
  feed(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(feedSchema)) q: { tab: 'new' | 'sale'; page: number },
  ) {
    return this.follows.feed(user.userId, q.tab, q.page);
  }

  /** Подписан ли на продавца и сколько у него подписчиков — для кнопки. */
  @Get(':sellerId')
  status(@CurrentUser() user: AuthUser, @Param('sellerId', ParseUUIDPipe) sellerId: string) {
    return this.follows.status(user.userId, sellerId);
  }

  @Post(':sellerId')
  follow(@CurrentUser() user: AuthUser, @Param('sellerId', ParseUUIDPipe) sellerId: string) {
    return this.follows.follow(user.userId, sellerId);
  }

  @Patch(':sellerId')
  setNotify(
    @CurrentUser() user: AuthUser,
    @Param('sellerId', ParseUUIDPipe) sellerId: string,
    @Body(new ZodValidationPipe(notifySchema)) body: { notify: boolean },
  ) {
    return this.follows.setNotify(user.userId, sellerId, body.notify);
  }

  @Delete(':sellerId')
  unfollow(@CurrentUser() user: AuthUser, @Param('sellerId', ParseUUIDPipe) sellerId: string) {
    return this.follows.unfollow(user.userId, sellerId);
  }
}
