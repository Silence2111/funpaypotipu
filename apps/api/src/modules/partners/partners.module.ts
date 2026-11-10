import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PartnersAdminController, PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

@Module({
  imports: [AuthModule],
  controllers: [PartnersController, PartnersAdminController],
  providers: [PartnersService],
  exports: [PartnersService],
})
export class PartnersModule {}
