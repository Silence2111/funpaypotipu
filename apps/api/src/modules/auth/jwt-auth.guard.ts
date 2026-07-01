import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from './token.service';

/** Защищает маршруты: проверяет Bearer access-токен и кладёт user в запрос. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Нет токена');

    try {
      const payload = this.tokens.verifyAccess(header.slice(7));
      req.user = { userId: payload.sub, username: payload.username };
      return true;
    } catch {
      throw new UnauthorizedException('Невалидный токен');
    }
  }
}
