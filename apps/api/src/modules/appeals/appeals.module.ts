import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModerationModule } from '../moderation/moderation.module';
import { GameChatModule } from '../game-chat/game-chat.module';
import { AppealsController, AppealsModerationController } from './appeals.controller';
import { AppealsService } from './appeals.service';

@Module({
  imports: [AuthModule, ModerationModule, GameChatModule],
  controllers: [AppealsController, AppealsModerationController],
  providers: [AppealsService],
  exports: [AppealsService],
})
export class AppealsModule {}
