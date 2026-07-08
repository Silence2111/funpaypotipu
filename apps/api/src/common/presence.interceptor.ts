import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../prisma/prisma.module';

/**
 * Обновляет `Profile.onlineAt` при любой аутентифицированной активности,
 * не чаще раза в минуту на пользователя (fire-and-forget, не блокирует ответ).
 * Даёт витрине статус «в сети / был N назад» как у FunPay/Playerok.
 */
@Injectable()
export class PresenceInterceptor implements NestInterceptor {
  private static readonly THROTTLE_MS = 60_000;
  private readonly lastSeen = new Map<string, number>();

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{ user?: { userId?: string } }>();
    const userId = req?.user?.userId;
    if (userId) {
      const now = Date.now();
      const last = this.lastSeen.get(userId) ?? 0;
      if (now - last > PresenceInterceptor.THROTTLE_MS) {
        this.lastSeen.set(userId, now);
        this.prisma.profile
          .updateMany({ where: { userId }, data: { onlineAt: new Date() } })
          .catch(() => {});
      }
    }
    return next.handle();
  }
}
