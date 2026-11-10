import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/modules/access/roles.guard';
import { STAFF_TWO_FACTOR } from '../src/modules/access/staff';

/**
 * Часть 119: сотруднику одного пароля мало — консоль и действия сотрудника
 * только с включённым входом с кодом. Покупателей и продавцов не касается:
 * у их маршрутов нет @Roles.
 */
function guard(user: { roles: string[]; twoFactor: boolean } | null, required: string[] | undefined) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () =>
        user
          ? {
              roles: user.roles.map((key) => ({ role: { key } })),
              twoFactor: user.twoFactor ? { enabledAt: new Date() } : null,
            }
          : null,
      ),
    },
  };
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  const ctx = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'u1' } }) }),
  } as unknown as ExecutionContext;
  return { run: () => new RolesGuard(reflector, prisma as never).canActivate(ctx), prisma };
}

const reason = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    const body = (e as ForbiddenException).getResponse() as { error?: string } | string;
    return typeof body === 'string' ? body : body.error ?? (e as Error).message;
  }
};

describe('RolesGuard — сотрудники только с входом с кодом', () => {
  it('маршрут без @Roles — без проверок, базу не спрашивает', async () => {
    const g = guard({ roles: [], twoFactor: false }, undefined);
    expect(await g.run()).toBe(true);
    expect(g.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('роль есть, кода нет — 403 «Включите вход с кодом»', async () => {
    expect(await reason(guard({ roles: ['finance'], twoFactor: false }, ['finance']).run())).toBe(STAFF_TWO_FACTOR);
  });

  it('роль и код — пускает; администратор — во все разделы', async () => {
    expect(await guard({ roles: ['finance'], twoFactor: true }, ['finance']).run()).toBe(true);
    expect(await guard({ roles: ['admin'], twoFactor: true }, ['moderator']).run()).toBe(true);
    expect(await reason(guard({ roles: ['admin'], twoFactor: false }, ['moderator']).run())).toBe(STAFF_TWO_FACTOR);
  });

  it('нет роли — «Недостаточно прав», с кодом или без', async () => {
    expect(await reason(guard({ roles: ['moderator'], twoFactor: true }, ['finance']).run())).toMatch(/Forbidden|прав/);
    expect(await reason(guard({ roles: [], twoFactor: false }, ['finance']).run())).toMatch(/Forbidden|прав/);
  });
});
