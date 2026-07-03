import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { ROLES_KEY } from './roles.decorator';

/** RBAC: проверяет роли пользователя из БД. 'admin' имеет доступ ко всему. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: { userId: string } }>();
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Не аутентифицирован');

    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    const keys = rows.map((r) => r.role.key);
    if (keys.includes('admin') || required.some((r) => keys.includes(r))) return true;
    throw new ForbiddenException('Недостаточно прав');
  }
}
