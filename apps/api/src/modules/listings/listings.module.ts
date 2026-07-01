import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

@Module({
  imports: [AuthModule], // JwtAuthGuard + TokenService
  controllers: [ListingsController],
  providers: [ListingsService],
})
export class ListingsModule {}
