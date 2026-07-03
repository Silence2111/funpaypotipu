import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ChatService } from './chat.service';

const sendSchema = z.object({ body: z.string().min(1).max(4000) });

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.chat.listConversations(user.userId);
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.getMessages(id, user.userId);
  }

  @Post(':id/messages')
  send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendSchema)) body: { body: string },
  ) {
    return this.chat.sendMessage(id, user.userId, body.body);
  }
}
