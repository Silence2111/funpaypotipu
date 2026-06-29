import { Body, Controller, Post, UsePipes } from '@nestjs/common';
import {
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @UsePipes(new ZodValidationPipe(registerSchema))
  register(@Body() body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post('login')
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(@Body() body: LoginInput) {
    return this.auth.login(body);
  }
}
