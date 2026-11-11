import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BonusesController } from './bonuses.controller';
import { BonusesService } from './bonuses.service';

@Module({
  imports: [AuthModule],
  controllers: [BonusesController],
  providers: [BonusesService],
  exports: [BonusesService],
})
export class BonusesModule {}
