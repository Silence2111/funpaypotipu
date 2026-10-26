import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './twofactor.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SocialController } from './social/social.controller';
import { SocialService } from './social/social.service';
import { EmailChangeController } from './email-change.controller';
import { EmailChangeService } from './email-change.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, SocialController, EmailChangeController],
  providers: [
    AuthService,
    TokenService,
    TwoFactorService,
    JwtAuthGuard,
    SocialService,
    EmailChangeService,
  ],
  exports: [TokenService, JwtAuthGuard],
})
export class AuthModule {}
