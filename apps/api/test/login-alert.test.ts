import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/modules/auth/auth.service';

/**
 * Вход с нового устройства. Проверяется через выдачу входа (issue):
 * регистрация и знакомое устройство молчат, новое — уведомление с
 * устройством и IP на языке человека; обновление токена — не вход.
 */

type Row = Record<string, unknown>;
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function setup(opts: { ever?: number; known?: number; locale?: string } = {}) {
  const prisma = {
    authSession: {
      create: vi.fn(async () => ({})),
      count: vi.fn(async ({ where }: { where: Row }) =>
        'OR' in where ? (opts.known ?? 0) : (opts.ever ?? 1),
      ),
    },
    user: {
      findUnique: vi.fn(async () => ({ locale: opts.locale ?? 'ru' })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    userRole: { findMany: vi.fn(async () => []) },
  };
  const tokens = { signAccess: vi.fn(() => 'access'), signRefresh: vi.fn(() => 'refresh') };
  const notifications = { notify: vi.fn(async () => undefined) };
  const moduleRef = { get: vi.fn(() => notifications) };
  const svc = new AuthService(
    prisma as never,
    tokens as never,
    {} as never,
    {} as never,
    moduleRef as never,
  );
  const issue = (ctx: Row, family?: string) =>
    (svc as unknown as { issue: (...a: unknown[]) => Promise<unknown> }).issue(
      'u1',
      null,
      'nick',
      ctx,
      family,
    );
  return { issue, prisma, notifications };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('вход с нового устройства', () => {
  it('новое устройство — уведомление с устройством и IP; по-английски у английского профиля', async () => {
    const ru = setup();
    await ru.issue({ userAgent: CHROME, ip: '203.0.113.7', fingerprint: 'fp-new' });
    await flush();
    // Ссылка ведёт к этому сеансу: «Это не я» завершит именно его.
    const created = ru.prisma.authSession.create.mock.calls[0]![0] as { data: Row };
    expect(ru.notifications.notify).toHaveBeenCalledWith('u1', 'new_login', {
      session: created.data.familyId,
      device: 'Chrome · Windows',
      ip: '203.0.113.7',
      preview: expect.stringMatching(
        /^Вход с нового устройства: Chrome · Windows, IP 203\.0\.113\.7\./,
      ),
    });
    // Ищет знакомое по отпечатку или строке браузера за полгода; «Это не я» не в счёт.
    const where = ru.prisma.authSession.count.mock.calls.find((c) => 'OR' in c[0].where)![0].where;
    expect(where.OR).toEqual([{ fingerprint: 'fp-new' }, { userAgent: CHROME }]);
    expect(where.deniedAt).toBeNull();

    const en = setup({ locale: 'en' });
    await en.issue({ userAgent: CHROME, ip: '203.0.113.7' });
    await flush();
    expect(en.notifications.notify.mock.calls[0]![2]).toMatchObject({
      preview: expect.stringMatching(/^Sign-in from a new device: Chrome · Windows/),
    });
  });

  it('регистрация, знакомое устройство и обновление токена — молчат', async () => {
    const first = setup({ ever: 0 });
    await first.issue({ userAgent: CHROME });
    const known = setup({ known: 1 });
    await known.issue({ userAgent: CHROME });
    const refresh = setup();
    await refresh.issue({ userAgent: 'другой' }, 'family-1');
    await flush();
    expect(first.notifications.notify).not.toHaveBeenCalled();
    expect(known.notifications.notify).not.toHaveBeenCalled();
    expect(refresh.notifications.notify).not.toHaveBeenCalled();
    expect(refresh.prisma.authSession.count).not.toHaveBeenCalled();
  });
});

describe('«Это не я»', () => {
  const FAMILY = '3f2b8a52-7c1e-4d7a-9a0b-2d6f1e4c8b91';

  function deny(seen: Row | null) {
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const findFirst = vi.fn(async () => seen);
    const prisma = {
      authSession: { findFirst, updateMany },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const svc = new AuthService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, updateMany };
  }

  it('завершает все сеансы этого устройства, кроме текущего, и отмечает их', async () => {
    const { svc, updateMany } = deny({ userAgent: CHROME, ip: '203.0.113.7', fingerprint: null });
    await expect(svc.denySession('u1', FAMILY, 'mine')).resolves.toEqual({
      ok: true,
      closedSessions: 2,
    });
    const [revoke, mark] = updateMany.mock.calls.map((c) => (c as unknown as [Row])[0]);
    const where = {
      userId: 'u1',
      familyId: { not: 'mine' },
      OR: [{ familyId: FAMILY }, { userAgent: CHROME, ip: '203.0.113.7' }],
    };
    expect(revoke).toEqual({
      where: { ...where, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mark).toEqual({
      where: { ...where, deniedAt: null },
      data: { deniedAt: expect.any(Date) },
    });

    // С отпечатком устройство узнаётся по нему, адрес не важен.
    const fp = deny({ userAgent: CHROME, ip: '198.51.100.1', fingerprint: 'fp-1' });
    await fp.svc.denySession('u1', FAMILY, 'mine');
    expect((fp.updateMany.mock.calls[0] as unknown as [Row])[0]).toMatchObject({
      where: { OR: [{ familyId: FAMILY }, { fingerprint: 'fp-1' }] },
    });
  });

  it('свой текущий, чужой и неверный сеанс — отказ', async () => {
    const seen = { userAgent: CHROME, ip: null, fingerprint: null };
    await expect(deny(seen).svc.denySession('u1', FAMILY, FAMILY)).rejects.toMatchObject({
      status: 400,
    });
    const foreign = deny(null);
    await expect(foreign.svc.denySession('u1', FAMILY, 'mine')).rejects.toMatchObject({
      status: 404,
    });
    expect(foreign.updateMany).not.toHaveBeenCalled();
    await expect(deny(seen).svc.denySession('u1', 'не-uuid', 'mine')).rejects.toMatchObject({
      status: 404,
    });
  });
});
