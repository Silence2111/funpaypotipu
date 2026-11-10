import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/modules/auth/auth.service';
import { TokenService } from '../src/modules/auth/token.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

/**
 * «Пароль изменён» и «Это не я»: смена пароля в кабинете и сброс по ссылке
 * дают уведомление с устройством и IP; ссылка «Это не я» — только в письме,
 * сутки и один раз. Ссылка сброса действует, пока пароль тот же.
 */

type Row = Record<string, unknown>;
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const CTX = { userAgent: CHROME, ip: '203.0.113.7' };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'access-secret';
});

async function setup(locale = 'ru') {
  const state = { hash: (await bcrypt.hash('old-password', 4)) as string | null };
  const prisma = {
    user: {
      findUnique: vi.fn(async ({ select }: { select: Row }) =>
        'locale' in select ? { locale } : { passwordHash: state.hash },
      ),
      update: vi.fn(async ({ data }: { data: { passwordHash: string } }) => {
        state.hash = data.passwordHash;
        return {};
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: { passwordHash: string } }) => {
        if (where.passwordHash !== state.hash) return { count: 0 };
        state.hash = data.passwordHash;
        return { count: 1 };
      }),
    },
    authSession: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 2 })),
    },
  };
  const tokens = new TokenService(new JwtService());
  const notifications = { notify: vi.fn(async () => undefined) };
  const moduleRef = { get: vi.fn(() => notifications) };
  const svc = new AuthService(
    prisma as never,
    tokens,
    {} as never,
    { enabled: false } as never,
    moduleRef as never,
  );
  /** Ссылка «Это не я» из последнего уведомления — токен из неё. */
  const notMeToken = () => {
    const call = notifications.notify.mock.calls.at(-1) as unknown as [
      string,
      string,
      Row,
      { mail: { action: string; link: string } },
    ];
    const url = new URL(call[3].mail.link);
    expect(url.pathname).toBe('/reset');
    expect(url.searchParams.get('not_me')).toBe('1');
    return url.searchParams.get('token')!;
  };
  return { svc, prisma, tokens, notifications, state, notMeToken };
}

describe('пароль изменён', () => {
  it('смена в кабинете — уведомление с устройством и IP, «Это не я» — только в письме', async () => {
    const { svc, notifications, notMeToken } = await setup();
    await svc.changePassword('u1', 'old-password', 'new-password-1', 'fam', CTX);
    await flush();
    const [userId, type, payload, opts] = notifications.notify.mock.calls[0] as unknown as [
      string,
      string,
      Row,
      { mail: { action: string; link: string } },
    ];
    expect([userId, type]).toEqual(['u1', 'password_changed']);
    expect(payload).toEqual({
      device: 'Chrome · Windows',
      ip: '203.0.113.7',
      preview: expect.stringMatching(/^Пароль изменён: Chrome · Windows, IP 203\.0\.113\.7\./),
    });
    // Ссылки сброса нет в данных уведомления: их видит тот, кто сейчас в аккаунте.
    expect(JSON.stringify(payload)).not.toMatch(/token|reset/);
    expect(opts.mail.action).toBe('Это не я — восстановить доступ');
    expect(notMeToken()).toBeTruthy();
  });

  it('«Это не я»: ссылка задаёт пароль, выводит все устройства и действует один раз', async () => {
    const { svc, prisma, notifications, notMeToken } = await setup();
    await svc.changePassword('u1', 'old-password', 'stolen-pass-1', 'fam', CTX);
    await flush();
    const token = notMeToken();
    await svc.resetPassword(token, 'my-own-pass-1', { userAgent: CHROME, ip: '198.51.100.4' });
    await flush();
    expect(prisma.authSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    // О восстановлении — тоже уведомление.
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect((notifications.notify.mock.calls[1] as unknown as [string, string])[1]).toBe(
      'password_changed',
    );
    // Второй раз та же ссылка не действует.
    await expect(svc.resetPassword(token, 'another-pass-1')).rejects.toThrow(
      /Ссылка недействительна или истекла/,
    );
  });

  it('ссылка «Забыли пароль» гаснет после любой смены пароля', async () => {
    const { svc, tokens, state } = await setup();
    // Ссылка, выданная при старом пароле: отпечаток — от него.
    const stamp = (await import('node:crypto'))
      .createHash('sha256')
      .update(`pwd:${state.hash}`)
      .digest('hex')
      .slice(0, 16);
    const early = tokens.signPurpose('u1', 'pwd_reset', 3600, stamp);
    await svc.changePassword('u1', 'old-password', 'new-password-1', 'fam', CTX);
    await expect(svc.resetPassword(early, 'whatever-pass-1')).rejects.toThrow(/недействительна/);
    // Без отпечатка (выдана до этой версии) — тоже нет.
    const bare = tokens.signPurpose('u1', 'pwd_reset', 3600);
    await expect(svc.resetPassword(bare, 'whatever-pass-1')).rejects.toThrow(/недействительна/);
  });

  it('английский профиль — превью по-английски', async () => {
    const { svc, notifications } = await setup('en');
    await svc.changePassword('u1', 'old-password', 'new-password-1', 'fam', CTX);
    await flush();
    expect(
      (notifications.notify.mock.calls[0] as unknown as [string, string, Row])[2],
    ).toMatchObject({
      preview: expect.stringMatching(/^Password changed: Chrome · Windows, IP 203\.0\.113\.7\./),
    });
  });
});

describe('письмо уведомления', () => {
  function notifier(locale: string) {
    const prisma = {
      notification: { create: vi.fn(async ({ data }: { data: Row }) => data) },
      user: {
        findUnique: vi.fn(async () => ({
          email: 'a@b.c',
          telegramId: null,
          notifyPrefs: { email: { security: false } },
          locale,
        })),
      },
    };
    const mail = { enabled: true, send: vi.fn(async () => undefined) };
    const off = { enabled: false };
    const svc = new NotificationsService(
      prisma as never,
      mail as never,
      off as never,
      off as never,
    );
    return { svc, mail, prisma };
  }

  it('подробности события и своя ссылка в письме; в базе ссылки нет; почту не выключить', async () => {
    const { svc, mail, prisma } = notifier('en');
    await svc.notify(
      'u1',
      'password_changed',
      { device: 'Chrome · Windows', preview: 'Password changed: Chrome · Windows, IP 1.2.3.4.' },
      {
        mail: {
          action: 'Это не я — восстановить доступ',
          link: 'https://gm.test/reset?token=t&not_me=1',
        },
      },
    );
    expect(mail.send).toHaveBeenCalledWith(
      'a@b.c',
      'Password changed',
      'Password changed.\n\nPassword changed: Chrome · Windows, IP 1.2.3.4.\n\nIt wasn’t me — restore access: https://gm.test/reset?token=t&not_me=1',
    );
    expect(JSON.stringify(prisma.notification.create.mock.calls[0])).not.toMatch(/token=/);
  });

  it('без своей ссылки — «Подробности» со ссылкой на сайт и превью', async () => {
    const { svc, mail } = notifier('ru');
    await svc.notify('u1', 'new_login', {
      session: 's1',
      preview: 'Вход с нового устройства: Firefox · Windows, IP 1.2.3.4.',
    });
    expect(mail.send).toHaveBeenCalledWith(
      'a@b.c',
      'Вход в аккаунт с нового устройства',
      expect.stringMatching(
        /^Вход в аккаунт с нового устройства\.\n\nВход с нового устройства: Firefox · Windows, IP 1\.2\.3\.4\.\n\nПодробности: http.*\/cabinet\/security\?session=s1$/,
      ),
    );
  });
});
