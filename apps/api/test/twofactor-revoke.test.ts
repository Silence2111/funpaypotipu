import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { JwtService } from '@nestjs/jwt';
import { TwoFactorService } from '../src/modules/auth/twofactor.service';
import { TokenService } from '../src/modules/auth/token.service';

/**
 * «Вход с кодом включён» и «Это не я». Чужой с украденным паролем включает
 * вход с кодом и меняет пароль — владелец оказывается снаружи. Ссылка из
 * письма выключает вход с кодом, только если назвать пароль, который был при
 * включении: его знает владелец, но не тот, кто лишь читает почту.
 */

type Row = Record<string, unknown>;
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const flush = () => new Promise((r) => setTimeout(r, 0));
const encryption = { encrypt: (s: string) => s, decrypt: (s: string) => s };

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'access-secret';
});

async function setup(password: string | null = 'owner-pass-1') {
  const secret = authenticator.generateSecret();
  const state = {
    user: { passwordHash: password ? await bcrypt.hash(password, 4) : null, locale: 'ru' },
    tf: {
      secretEnc: secret,
      enabledAt: null as Date | null,
      recoveryCodesEnc: null as string | null,
      passwordHashAtEnable: null as string | null,
    } as Row | null,
  };
  const prisma = {
    twoFactor: {
      findUnique: vi.fn(async () => state.tf),
      update: vi.fn(async ({ data }: { data: Row }) => Object.assign(state.tf!, data)),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        if (!state.tf?.enabledAt || where.secretEnc !== state.tf.secretEnc) return { count: 0 };
        state.tf = null;
        return { count: 1 };
      }),
    },
    user: {
      findUnique: vi.fn(async () => state.user),
      update: vi.fn(async ({ data }: { data: { passwordHash: string } }) => {
        state.user.passwordHash = data.passwordHash;
        return {};
      }),
    },
    authSession: { deleteMany: vi.fn(async () => ({ count: 3 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const tokens = new TokenService(new JwtService());
  const svc = new TwoFactorService(prisma as never, encryption as never, tokens, {
    get: () => notifications,
  } as never);
  const enable = async () => {
    await svc.enable('u1', authenticator.generate(secret), {
      userAgent: CHROME,
      ip: '203.0.113.7',
    });
    await flush();
  };
  /** Токен из ссылки «Это не я» последнего письма о включении. */
  const link = () => {
    const call = notifications.notify.mock.calls.find(
      (c) => (c as unknown[])[1] === 'two_factor_enabled',
    ) as [string, string, Row, { mail: { action: string; link: string } }] | undefined;
    const url = new URL(call![3].mail.link);
    expect(url.pathname).toBe('/recover-2fa');
    return url.searchParams.get('token')!;
  };
  return { svc, prisma, state, notifications, tokens, enable, link };
}

describe('вход с кодом включён — «Это не я»', () => {
  it('включение — уведомление с устройством и IP, ссылка только в письме, пароль запомнен', async () => {
    const { notifications, state, enable } = await setup();
    await enable();
    const [, type, payload, opts] = notifications.notify.mock.calls[0] as unknown as [
      string,
      string,
      Row,
      { mail: { action: string; link: string } },
    ];
    expect(type).toBe('two_factor_enabled');
    expect(payload).toMatchObject({
      device: 'Chrome · Windows',
      ip: '203.0.113.7',
      preview: expect.stringMatching(/^Вход с кодом из приложения включён: Chrome · Windows/),
    });
    expect(JSON.stringify(payload)).not.toMatch(/token|recover/);
    expect(opts.mail.action).toBe('Это не я — выключить вход с кодом');
    expect(state.tf!.passwordHashAtEnable).toBe(state.user.passwordHash);
  });

  it('чужой включил и сменил пароль — владелец своим паролем выключает вход с кодом, задаёт новый, все выходят', async () => {
    const { svc, prisma, state, notifications, enable, link } = await setup();
    await enable();
    state.user.passwordHash = await bcrypt.hash('stolen-pass-1', 4); // чужой сменил пароль
    await expect(svc.revokeByLink(link(), 'owner-pass-1', 'brand-new-1')).resolves.toEqual({
      ok: true,
    });
    await flush();
    expect(state.tf).toBeNull();
    expect(await bcrypt.compare('brand-new-1', state.user.passwordHash!)).toBe(true);
    expect(prisma.authSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect((notifications.notify.mock.calls.at(-1) as unknown as [string, string])[1]).toBe(
      'two_factor_disabled',
    );
    // Ссылка одна: вход с кодом уже выключен.
    await expect(svc.revokeByLink(link(), 'owner-pass-1', 'other-new-1')).rejects.toThrow(
      /Ссылка недействительна/,
    );
  });

  it('кто читает почту и сбросил пароль, своим новым паролем защиту не снимет; перебор — пауза', async () => {
    const { svc, state, enable, link } = await setup();
    await enable();
    state.user.passwordHash = await bcrypt.hash('via-email-1', 4); // сброс через почту
    for (let i = 0; i < 5; i++) {
      await expect(svc.revokeByLink(link(), 'via-email-1', 'mine-now-1')).rejects.toThrow(
        /не тот пароль/,
      );
    }
    await expect(svc.revokeByLink(link(), 'owner-pass-1', 'mine-now-1')).rejects.toMatchObject({
      status: 429,
    });
    expect(state.tf).not.toBeNull();
  });

  it('ссылка к другому ключу, без отпечатка или у аккаунта без пароля — отказ', async () => {
    const { svc, tokens, state, enable, link } = await setup();
    await enable();
    const token = link();
    state.tf!.secretEnc = authenticator.generateSecret(); // ключ сменили
    await expect(svc.revokeByLink(token, 'owner-pass-1', 'brand-new-1')).rejects.toThrow(
      /Ссылка недействительна/,
    );
    const bare = tokens.signPurpose('u1', 'tf_revoke', 600);
    await expect(svc.revokeByLink(bare, 'owner-pass-1', 'brand-new-1')).rejects.toThrow(
      /Ссылка недействительна/,
    );

    const oauth = await setup(null);
    await oauth.enable();
    await expect(oauth.svc.revokeByLink(oauth.link(), 'x', 'brand-new-1')).rejects.toThrow(
      /не было пароля/,
    );
  });
});
