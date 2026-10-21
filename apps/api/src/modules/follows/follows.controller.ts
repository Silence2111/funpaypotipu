import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FollowsService } from './follows.service';

const notifySchema = z.object({ notify: z.boolean() });

@Controller('follows')
@UseGuards(JwtAuthGuard)
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  /** «Мои подписки». */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.follows.list(user.userId);
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
