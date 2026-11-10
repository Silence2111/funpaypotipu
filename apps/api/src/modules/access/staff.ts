import { ForbiddenException } from '@nestjs/common';
import type { PrismaClient } from '@gamemarket/db';

/**
 * Сотрудник площадки — администратор, финансы, модератор, арбитр (часть 119).
 * Им одного пароля мало: финансы открывают реквизиты и одобряют выплаты,
 * администратор меняет комиссии и роли. Утёк пароль — ушли деньги. Поэтому
 * консоль и действия сотрудника — только с включённым входом с кодом.
 * Покупателей и продавцов это не касается.
 */
export const STAFF_ROLES = ['admin', 'finance', 'moderator', 'agent'] as const;

export const STAFF_TWO_FACTOR = 'staff_two_factor_required';

export const staffTwoFactorError = () =>
  new ForbiddenException({
    statusCode: 403,
    message: 'Включите вход с кодом: консоль и действия сотрудника — только с ним',
    error: STAFF_TWO_FACTOR,
  });

/** Роли человека и включён ли у него вход с кодом — одним запросом. */
export async function staffState(
  prisma: PrismaClient,
  userId: string,
): Promise<{ roles: string[]; twoFactor: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: { select: { role: { select: { key: true } } } }, twoFactor: { select: { enabledAt: true } } },
  });
  return {
    roles: user?.roles.map((r) => r.role.key) ?? [],
    twoFactor: !!user?.twoFactor?.enabledAt,
  };
}

/**
 * Сотрудник ли он для этого действия: роль из `allowed` и вход с кодом.
 * Роль есть, а кода нет — 403 «Включите вход с кодом», если `strict`;
 * иначе — просто не сотрудник (участник сделки действует как участник).
 */
export async function asStaff(
  prisma: PrismaClient,
  userId: string,
  allowed: readonly string[] = STAFF_ROLES,
): Promise<{ staff: boolean; needsTwoFactor: boolean }> {
  const { roles, twoFactor } = await staffState(prisma, userId);
  const role = roles.some((r) => allowed.includes(r));
  return { staff: role && twoFactor, needsTwoFactor: role && !twoFactor };
}
