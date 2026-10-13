import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { TokenService, type AccessPayload } from './token.service';

/**
 * Защищает маршруты: проверяет Bearer access-токен и кладёт user в запрос.
 *
 * Статус аккаунта сверяется с базой на каждом запросе: бан действует сразу,
 * а не когда истечёт выданный до него access-токен. Раньше бан менял только
 * строку в базе — забаненный продолжал продавать и выводить деньги.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Нет токена');

    let payload: AccessPayload;
    try {
      payload = this.tokens.verifyAccess(header.slice(7));
    } catch {
      throw new UnauthorizedException('Невалидный токен');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { status: true } });
    if (!user) throw new UnauthorizedException('Пользователь не найден');
    if (user.status === 'banned') throw new UnauthorizedException('Аккаунт заблокирован');
    req.user = { userId: payload.sub, username: payload.username };
    return true;
  }
}
