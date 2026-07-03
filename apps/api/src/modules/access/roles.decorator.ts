import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Ограничить доступ к маршруту ролями (проверяется RolesGuard после JwtAuthGuard). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
