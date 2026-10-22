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
    expect(ru.notifications.notify).toHaveBeenCalledWith('u1', 'new_login', {
      device: 'Chrome · Windows',
      ip: '203.0.113.7',
      preview: expect.stringMatching(
        /^Вход с нового устройства: Chrome · Windows, IP 203\.0\.113\.7\./,
      ),
    });
    // Ищет знакомое по отпечатку или строке браузера за полгода.
    const where = ru.prisma.authSession.count.mock.calls.find((c) => 'OR' in c[0].where)![0].where;
    expect(where.OR).toEqual([{ fingerprint: 'fp-new' }, { userAgent: CHROME }]);

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
