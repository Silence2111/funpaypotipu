import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from '../src/modules/auth/token.service';
import {
  OAUTH_PROVIDERS,
  authorizeUrl,
  fetchProfile,
  isOAuthProvider,
  oauthConfig,
  pkce,
} from '../src/modules/auth/social/providers';
import { SocialService, canSignIn, safeNext } from '../src/modules/auth/social/social.service';

/**
 * Вход через VK ID и Яндекс ID. Ошибка здесь отдаёт чужой аккаунт, поэтому
 * проверяется прежде всего то, что запрещено: чужой state, вход в аккаунт по
 * неподтверждённой почте, уход на чужой адрес после входа, вход через
 * Telegram (убран, часть 118).
 */

process.env.JWT_ACCESS_SECRET = 'test-access-secret';
const tokens = new TokenService(new JwtService({}));

const BOT = '123456:TEST-bot-token';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.YANDEX_CLIENT_ID;
  delete process.env.YANDEX_CLIENT_SECRET;
  delete process.env.VK_CLIENT_ID;
  process.env.TELEGRAM_BOT_TOKEN = BOT;
  process.env.TELEGRAM_BOT_USERNAME = 'gm_test_bot';
});

describe('вход через Telegram убран (часть 118, 149-ФЗ ч. 10 ст. 8)', () => {
  it('кнопки нет, даже если бот подключён к уведомлениям', () => {
    expect(service({}).svc.providers()).toMatchObject({ telegram: null });
  });

  it('билет Telegram, выданный раньше, — 410, а не вход и не новый аккаунт', async () => {
    const { svc, auth, created } = service({ users: [{ id: 'u2', telegramId: '777' }] });
    const t = ticketFor({ provider: 'telegram', subject: '777' });
    await expect(svc.complete(t, {}, {})).rejects.toMatchObject({ status: 410, response: { error: 'telegram_login_removed' } });
    await expect(svc.complete(t, { username: 'tg_user', pdConsent: true }, {})).rejects.toMatchObject({ status: 410 });
    expect(auth.loginVerified).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('войти можно почтой с паролем или Яндекс ID / VK ID; старый Telegram — не способ', () => {
    expect(canSignIn({ passwordHash: 'h', email: 'a@b.ru', socialAccounts: [] })).toBe(true);
    expect(canSignIn({ passwordHash: null, email: null, socialAccounts: [{ provider: 'yandex' }] })).toBe(true);
    expect(canSignIn({ passwordHash: null, email: null, socialAccounts: [{ provider: 'telegram' }] })).toBe(false);
    expect(canSignIn({ passwordHash: 'h', email: null, socialAccounts: [{ provider: 'telegram' }] })).toBe(false);
    expect(canSignIn({ passwordHash: null, email: 'a@b.ru', socialAccounts: [{ provider: 'telegram' }] })).toBe(false);
  });
});

describe('обмен кодом', () => {
  it('без ключей сервиса кнопки нет', () => {
    expect(oauthConfig('yandex')).toBeNull();
    expect(oauthConfig('vk')).toBeNull();
  });

  it('адрес сервиса — с state и PKCE S256', () => {
    process.env.VK_CLIENT_ID = 'vk-app';
    const { verifier, challenge } = pkce();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    const url = new URL(
      authorizeUrl(oauthConfig('vk')!, { redirectUri: 'http://api/cb', state: 's1', challenge }),
    );
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
  });

  it('Google нет: ни кнопки, ни начала входа — только российские сервисы (149-ФЗ)', () => {
    process.env.GOOGLE_CLIENT_ID = 'g';
    process.env.GOOGLE_CLIENT_SECRET = 's';
    expect(isOAuthProvider('google')).toBe(false);
    expect(OAUTH_PROVIDERS).toEqual(['yandex', 'vk']);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('Яндекс ID: код — с секретом и PKCE, профиль — с «OAuth <токен>»; логин — подсказка ника, основная почта подтверждена', async () => {
    process.env.YANDEX_CLIENT_ID = 'ya-app';
    process.env.YANDEX_CLIENT_SECRET = 'ya-secret';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init });
      const body = String(url).includes('/token')
        ? { access_token: 'ya-token', token_type: 'bearer' }
        : { id: '1130000012345678', login: 'anna.smirnova', default_email: 'Anna@Yandex.ru', real_name: 'Анна Смирнова', display_name: 'anna' };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const c = oauthConfig('yandex')!;
    expect(c.authorizeUrl).toBe('https://oauth.yandex.ru/authorize');
    const profile = await fetchProfile(c, { code: 'c1', verifier: 'v1', redirectUri: 'http://api/cb', state: 's1' });
    fetchMock.mockRestore();
    expect(profile).toEqual({
      provider: 'yandex',
      subject: '1130000012345678',
      email: 'anna@yandex.ru',
      emailVerified: true,
      name: 'Анна Смирнова',
      nick: 'anna.smirnova',
    });
    const form = new URLSearchParams(String(calls[0]!.init!.body));
    expect(calls[0]!.url).toBe('https://oauth.yandex.ru/token');
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code',
      code: 'c1',
      code_verifier: 'v1',
      client_id: 'ya-app',
      client_secret: 'ya-secret',
    });
    expect(calls[1]!.url).toBe('https://login.yandex.ru/info?format=json');
    expect((calls[1]!.init!.headers as Record<string, string>).Authorization).toBe('OAuth ya-token');
  });

  it('Яндекс ID без почты — почты нет и она не «подтверждена»', async () => {
    process.env.YANDEX_CLIENT_ID = 'ya-app';
    process.env.YANDEX_CLIENT_SECRET = 'ya-secret';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      new Response(JSON.stringify(String(url).includes('/token') ? { access_token: 't' } : { id: 42, login: 'x' }), { status: 200 }),
    );
    const profile = await fetchProfile(oauthConfig('yandex')!, { code: 'c', verifier: 'v', redirectUri: 'r', state: 's' });
    fetchMock.mockRestore();
    expect(profile).toMatchObject({ subject: '42', email: null, emailVerified: false, name: null });
  });

  it('после входа — только путь на этом сайте', () => {
    expect(safeNext('/lot/1?x=2')).toBe('/lot/1?x=2');
    for (const bad of [
      '//evil.com',
      'https://evil.com',
      '/\\evil.com',
      'javascript:alert(1)',
      42,
    ]) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});

function service(db: {
  links?: Array<{ id: string; userId: string; provider: string; subject: string }>;
  users?: Array<{
    id: string;
    email?: string | null;
    emailVerified?: Date | null;
    telegramId?: string | null;
    passwordHash?: string | null;
  }>;
  usernames?: string[];
}) {
  const links = db.links ?? [];
  const users = db.users ?? [];
  const usernames = new Set(db.usernames ?? []);
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    socialAccount: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: Record<string, { provider: string; subject?: string; userId?: string }>;
        }) => {
          const k = where.provider_subject ?? where.userId_provider;
          return (
            links.find(
              (l) =>
                l.provider === k!.provider &&
                (k!.subject ? l.subject === k!.subject : l.userId === k!.userId),
            ) ?? null
          );
        },
      ),
      update: vi.fn(async () => ({})),
      create: vi.fn(
        async ({ data }: { data: { userId: string; provider: string; subject: string } }) => {
          links.push({ id: `l${links.length}`, ...data });
          return data;
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) =>
        links.splice(
          links.findIndex((l) => l.id === where.id),
          1,
        ),
      ),
    },
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { id?: string; email?: string; telegramId?: string } }) => {
          const u = users.find(
            (x) =>
              (where.id && x.id === where.id) ||
              (where.email && x.email === where.email) ||
              (where.telegramId && x.telegramId === where.telegramId),
          );
          if (!u) return null;
          return {
            ...u,
            socialAccounts: links
              .filter((l) => l.userId === u.id)
              .map((l) => ({ ...l, name: null, email: null, createdAt: new Date() })),
          };
        },
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'new-user' };
      }),
    },
    profile: {
      findUnique: vi.fn(async ({ where }: { where: { username: string } }) =>
        usernames.has(where.username) ? { userId: 'x' } : null,
      ),
    },
  };
  const auth = {
    loginVerified: vi.fn(async (userId: string) => ({
      user: { id: userId },
      accessToken: 'a',
      refreshToken: 'r',
    })),
  };
  return {
    svc: new SocialService(prisma as never, tokens, auth as never, { notify: vi.fn(async () => undefined) } as never),
    auth,
    created,
    links,
    prisma,
  };
}

const ticketFor = (p: Record<string, unknown>) =>
  tokens.signData(
    { email: null, emailVerified: false, name: null, nick: null, ...p },
    'social_ticket',
    600,
  );

describe('завершение входа', () => {
  it('аккаунт сервиса привязан — вход в него, с той же проверкой кода, что у пароля', async () => {
    const { svc, auth } = service({
      links: [{ id: 'l1', userId: 'u1', provider: 'yandex', subject: 'g-1' }],
    });
    await svc.complete(ticketFor({ provider: 'yandex', subject: 'g-1' }), { code: '123456' }, {});
    expect(auth.loginVerified).toHaveBeenCalledWith('u1', '123456', {});
  });

  it('почту подтвердили и Яндекс ID, и площадка — аккаунт находится', async () => {
    const { svc, auth } = service({
      users: [{ id: 'u3', email: 'kim@mail.ru', emailVerified: new Date() }],
    });
    await svc.complete(
      ticketFor({ provider: 'yandex', subject: 'g-3', email: 'kim@mail.ru', emailVerified: true }),
      {},
      {},
    );
    expect(auth.loginVerified).toHaveBeenCalledWith('u3', undefined, {});
  });

  it('почта на площадке не подтверждена — чужой аккаунт по ней не отдаётся', async () => {
    const { svc, auth } = service({
      users: [{ id: 'u4', email: 'kim@mail.ru', emailVerified: null }],
    });
    await expect(
      svc.complete(
        ticketFor({
          provider: 'yandex',
          subject: 'g-4',
          email: 'kim@mail.ru',
          emailVerified: true,
        }),
        {},
        {},
      ),
    ).rejects.toMatchObject({ response: { error: 'social_email_taken' } });
    expect(auth.loginVerified).not.toHaveBeenCalled();
  });

  it('новый человек — сначала ник, подсказка из имени', async () => {
    const { svc, created } = service({ usernames: ['miroslava_kim'] });
    const t = ticketFor({ provider: 'vk', subject: 'vk-5', name: 'Мирослава Ким' });
    await expect(svc.complete(t, {}, {})).rejects.toMatchObject({
      response: { error: 'username_required', suggested: 'miroslava_kim2' },
    });
    await expect(svc.complete(t, { username: 'miroslava_kim' }, {})).rejects.toMatchObject({
      response: { error: 'username_taken' },
    });
    // Без отдельного согласия на обработку ПД аккаунт не заводится (часть 120).
    await expect(svc.complete(t, { username: 'mirka_vk' }, {})).rejects.toMatchObject({
      response: { error: 'consent_required' },
    });
    await svc.complete(t, { username: 'mirka_vk', pdConsent: true }, { ip: '10.0.0.5' });
    expect(created[0]).toMatchObject({
      profile: { create: { username: 'mirka_vk', displayName: 'Мирослава Ким' } },
      socialAccounts: { create: { provider: 'vk', subject: 'vk-5' } },
      consents: { create: { method: 'vk', ip: '10.0.0.5' } },
    });
  });

  it('билета нет или он чужого назначения — вход не начинается', async () => {
    const { svc } = service({});
    await expect(svc.complete(undefined, {}, {})).rejects.toMatchObject({
      response: { error: 'social_expired' },
    });
    await expect(
      svc.complete(tokens.signPurpose('u1', 'email_verify'), {}, {}),
    ).rejects.toMatchObject({
      response: { error: 'social_expired' },
    });
  });
});

describe('возврат от сервиса', () => {
  it('state не совпал с cookie браузера — ни входа, ни привязки', async () => {
    process.env.YANDEX_CLIENT_ID = 'g';
    process.env.YANDEX_CLIENT_SECRET = 's';
    const { svc } = service({});
    const { stateCookie } = svc.start('yandex', '/lot/1');
    const r = await svc.callback('yandex', { code: 'c', state: 'чужой' }, stateCookie);
    expect(r.redirect).toMatch(/social_error=state$/);
    expect(r.ticket).toBeUndefined();
  });

  it('куда вернуть — из state, чужой адрес не проходит', () => {
    process.env.YANDEX_CLIENT_ID = 'g';
    process.env.YANDEX_CLIENT_SECRET = 's';
    const { svc } = service({});
    const st = tokens.verifyData<{ next: string }>(
      svc.start('yandex', '//evil.com').stateCookie,
      'oauth_state',
    );
    expect(st.next).toBe('/');
  });
});

describe('способы входа в «Безопасности»', () => {
  it('единственный способ входа без пароля не отключается', async () => {
    const { svc } = service({
      users: [{ id: 'u6', passwordHash: null }],
      links: [{ id: 'l6', userId: 'u6', provider: 'yandex', subject: 'g-6' }],
    });
    await expect(svc.unlink('u6', 'yandex')).rejects.toThrow(/единственный способ входа/);
  });

  it('чужой аккаунт сервиса к себе не привязать', async () => {
    const { svc } = service({
      links: [{ id: 'l7', userId: 'u7', provider: 'vk', subject: 'vk-7' }],
    });
    await expect(
      svc.link('u8', {
        provider: 'vk',
        subject: 'vk-7',
        email: null,
        emailVerified: false,
        name: null,
        nick: null,
      }),
    ).rejects.toThrow(/другому аккаунту/);
  });
});

describe('токены из писем', () => {
  it('ссылка подтверждения почты и сброса пароля — не вход в API', () => {
    expect(() => tokens.verifyAccess(tokens.signPurpose('u1', 'email_verify'))).toThrow();
    expect(() =>
      tokens.verifyAccess(tokens.signData({ userId: 'u1' }, 'social_link', 60)),
    ).toThrow();
    expect(tokens.verifyAccess(tokens.signAccess({ sub: 'u1', username: 'kim' }))).toMatchObject({
      sub: 'u1',
    });
  });
});
