import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from '../src/modules/auth/token.service';
import {
  authorizeUrl,
  oauthConfig,
  pkce,
  verifyTelegramLogin,
} from '../src/modules/auth/social/providers';
import { SocialService, safeNext } from '../src/modules/auth/social/social.service';

/**
 * Вход через Telegram, VK и Google. Ошибка здесь отдаёт чужой аккаунт,
 * поэтому проверяется прежде всего то, что запрещено: поддельные данные
 * Telegram, чужой state, вход в аккаунт по неподтверждённой почте, уход
 * на чужой адрес после входа.
 */

process.env.JWT_ACCESS_SECRET = 'test-access-secret';
const tokens = new TokenService(new JwtService({}));

const BOT = '123456:TEST-bot-token';
function signTelegram(fields: Record<string, string | number>, token = BOT) {
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const hash = createHmac('sha256', createHash('sha256').update(token).digest())
    .update(check)
    .digest('hex');
  return { ...fields, hash };
}
const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.VK_CLIENT_ID;
  process.env.TELEGRAM_BOT_TOKEN = BOT;
  process.env.TELEGRAM_BOT_USERNAME = 'gm_test_bot';
});

describe('данные виджета Telegram', () => {
  const data = () =>
    signTelegram({ id: 777, first_name: 'Мирослава', username: 'mirka', auth_date: now() });

  it('подпись верная — это человек из Telegram', () => {
    expect(verifyTelegramLogin(data(), BOT)).toMatchObject({
      provider: 'telegram',
      subject: '777',
      nick: 'mirka',
    });
  });

  it('подменили id или подписали другим ботом — не проходит', () => {
    expect(verifyTelegramLogin({ ...data(), id: 778 }, BOT)).toBeNull();
    expect(
      verifyTelegramLogin(signTelegram({ id: 777, auth_date: now() }, '999:other'), BOT),
    ).toBeNull();
  });

  it('данные старше суток не принимаются', () => {
    expect(
      verifyTelegramLogin(signTelegram({ id: 777, auth_date: now() - 2 * 86400 }), BOT),
    ).toBeNull();
  });

  it('новые поля Telegram подпись не ломают', () => {
    expect(
      verifyTelegramLogin(
        signTelegram({ id: 777, auth_date: now(), photo_url: 'https://t.me/i/x.jpg' }),
        BOT,
      ),
    ).not.toBeNull();
  });
});

describe('обмен кодом', () => {
  it('без ключей сервиса кнопки нет', () => {
    expect(oauthConfig('google')).toBeNull();
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
    svc: new SocialService(prisma as never, tokens, auth as never),
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
      links: [{ id: 'l1', userId: 'u1', provider: 'google', subject: 'g-1' }],
    });
    await svc.complete(ticketFor({ provider: 'google', subject: 'g-1' }), { code: '123456' }, {});
    expect(auth.loginVerified).toHaveBeenCalledWith('u1', '123456', {});
  });

  it('Telegram уже подключён к уведомлениям — это тот же человек', async () => {
    const { svc, auth, links } = service({ users: [{ id: 'u2', telegramId: '777' }] });
    await svc.complete(ticketFor({ provider: 'telegram', subject: '777' }), {}, {});
    expect(auth.loginVerified).toHaveBeenCalledWith('u2', undefined, {});
    expect(links).toMatchObject([{ userId: 'u2', provider: 'telegram', subject: '777' }]);
  });

  it('почту подтвердили и Google, и площадка — аккаунт находится', async () => {
    const { svc, auth } = service({
      users: [{ id: 'u3', email: 'kim@mail.ru', emailVerified: new Date() }],
    });
    await svc.complete(
      ticketFor({ provider: 'google', subject: 'g-3', email: 'kim@mail.ru', emailVerified: true }),
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
          provider: 'google',
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
    await svc.complete(t, { username: 'mirka_vk' }, {});
    expect(created[0]).toMatchObject({
      profile: { create: { username: 'mirka_vk', displayName: 'Мирослава Ким' } },
      socialAccounts: { create: { provider: 'vk', subject: 'vk-5' } },
    });
  });

  it('новый из Telegram — уведомления в Telegram сразу', async () => {
    const { svc, created } = service({});
    await svc.complete(
      ticketFor({ provider: 'telegram', subject: '888', nick: 'tg_user' }),
      { username: 'tg_user' },
      {},
    );
    expect(created[0]).toMatchObject({ telegramId: '888' });
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
    process.env.GOOGLE_CLIENT_ID = 'g';
    process.env.GOOGLE_CLIENT_SECRET = 's';
    const { svc } = service({});
    const { stateCookie } = svc.start('google', '/lot/1');
    const r = await svc.callback('google', { code: 'c', state: 'чужой' }, stateCookie);
    expect(r.redirect).toMatch(/social_error=state$/);
    expect(r.ticket).toBeUndefined();
  });

  it('куда вернуть — из state, чужой адрес не проходит', () => {
    process.env.GOOGLE_CLIENT_ID = 'g';
    process.env.GOOGLE_CLIENT_SECRET = 's';
    const { svc } = service({});
    const st = tokens.verifyData<{ next: string }>(
      svc.start('google', '//evil.com').stateCookie,
      'oauth_state',
    );
    expect(st.next).toBe('/');
  });
});

describe('способы входа в «Безопасности»', () => {
  it('единственный способ входа без пароля не отключается', async () => {
    const { svc } = service({
      users: [{ id: 'u6', passwordHash: null }],
      links: [{ id: 'l6', userId: 'u6', provider: 'google', subject: 'g-6' }],
    });
    await expect(svc.unlink('u6', 'google')).rejects.toThrow(/единственный способ входа/);
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
