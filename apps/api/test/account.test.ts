import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcryptjs';
import { BlocksService } from '../src/modules/access/blocks.service';
import { ChatService } from '../src/modules/chat/chat.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';

/**
 * Чёрный список, смена пароля и сеансы. Проверяется то, ради чего их
 * заводят: заблокированный не пишет и не покупает, но сделку довести
 * можно; смена пароля и «завершить сеанс» выкидывают чужое устройство
 * сразу, а не через 15 минут жизни токена.
 */

beforeEach(() => vi.clearAllMocks());

function blocksWith(rows: Array<{ blockerId: string }>, target?: Record<string, unknown>) {
  const prisma = {
    userBlock: { findMany: vi.fn(async () => rows), upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})) },
    user: { findUnique: vi.fn(async () => target ?? null) },
    listing: { findUnique: vi.fn(async () => ({ sellerId: 'seller' })) },
  };
  return { svc: new BlocksService(prisma as never), prisma };
}

describe('чёрный список', () => {
  it('продавец добавил покупателя — тот не покупает и не пишет', async () => {
    const { svc } = blocksWith([{ blockerId: 'seller' }]);
    await expect(svc.assertCanBuy('buyer', 'l1')).rejects.toThrow(/ограничил вам покупки/);
    await expect(svc.assertCanContact('buyer', 'seller', 'message')).rejects.toThrow(/ограничил переписку/);
  });

  it('свой чёрный список тоже действует — с подсказкой, как его снять', async () => {
    const { svc } = blocksWith([{ blockerId: 'buyer' }]);
    await expect(svc.assertCanContact('buyer', 'seller', 'message')).rejects.toThrow(/уберите его оттуда/);
  });

  it('себя и сотрудника площадки не добавить', async () => {
    await expect(blocksWith([]).svc.add('u1', 'u1')).rejects.toThrow(/Себя/);
    const staff = { id: 'mod', roles: [{ role: { key: 'moderator' } }] };
    await expect(blocksWith([], staff).svc.add('u1', 'mod')).rejects.toThrow(/Сотрудника/);
  });

  it('чат: до сделки закрыт, по оплаченному заказу — открыт', async () => {
    const make = (orderId: string | null) => {
      const prisma = {
        conversation: {
          findUnique: vi.fn(async () => ({ id: 'c1', orderId, buyerId: 'buyer', sellerId: 'seller' })),
          update: vi.fn(async () => ({})),
        },
        message: { create: vi.fn(async ({ data }: { data: object }) => ({ id: 'm1', createdAt: new Date(), ...data })) },
        riskSignal: { create: vi.fn(async () => ({})) },
        profile: { findUnique: vi.fn(async () => ({ username: 'buyer' })), findMany: vi.fn(async () => []) },
        // Команды продавца: заготовок нет — автоответа нет.
        replyTemplate: { findFirst: vi.fn(async () => null), count: vi.fn(async () => 0) },
      };
      const { svc: blocks } = blocksWith([{ blockerId: 'seller' }]);
      return new ChatService(prisma as never, { notify: vi.fn() } as never, {} as never, {} as never, blocks);
    };
    await expect(make(null).sendMessage('c1', 'buyer', 'привет')).rejects.toThrow(/ограничил переписку/);
    await expect(make('o1').sendMessage('c1', 'buyer', 'ключ не подходит')).resolves.toMatchObject({ id: 'm1' });
  });
});

describe('пароль и сеансы', () => {
  async function auth(hash: string | null) {
    const prisma = {
      user: {
        findUnique: vi.fn(async () => ({ passwordHash: hash, email: null })),
        update: vi.fn(async () => ({})),
      },
      authSession: { updateMany: vi.fn(async () => ({ count: 2 })) },
    };
    const svc = new AuthService(prisma as never, {} as never, {} as never, { enabled: false } as never);
    return { svc, prisma };
  }

  it('без верного текущего пароля не меняется', async () => {
    const { svc, prisma } = await auth(await bcrypt.hash('old-password', 4));
    await expect(svc.changePassword('u1', 'wrong', 'new-password-1')).rejects.toThrow(/Текущий пароль неверный/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('смена пароля закрывает остальные устройства, текущее остаётся', async () => {
    const { svc, prisma } = await auth(await bcrypt.hash('old-password', 4));
    const r = await svc.changePassword('u1', 'old-password', 'new-password-1', 'fam-here');
    expect(r.closedSessions).toBe(2);
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null, familyId: { not: 'fam-here' } } }),
    );
  });

  it('текущий сеанс так не завершают — для этого есть «Выйти»', async () => {
    const { svc } = await auth(null);
    await expect(svc.revokeSession('u1', 'fam-here', 'fam-here')).rejects.toThrow(/текущий сеанс/);
  });

  it('завершённый сеанс отсекается сразу, даже с живым токеном', async () => {
    const tokens = { verifyAccess: () => ({ sub: 'u1', username: 'u', fam: 'fam-closed' }) };
    const prisma = { authSession: { findFirst: vi.fn(async () => null) } };
    const guard = new JwtAuthGuard(tokens as never, prisma as never);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer t' } }) }) };
    await expect(guard.canActivate(ctx as never)).rejects.toThrow(/Сеанс завершён/);
  });
});
