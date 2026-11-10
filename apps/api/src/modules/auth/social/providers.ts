import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type SocialProvider = 'google' | 'vk' | 'telegram';
export const OAUTH_PROVIDERS = ['google', 'vk'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<SocialProvider, string> = {
  google: 'Google',
  vk: 'VK ID',
  telegram: 'Telegram',
};

/** Кто вошёл через сервис — то, что нужно, чтобы найти или завести аккаунт. */
export interface SocialProfile {
  provider: SocialProvider;
  /** id пользователя в сервисе — не меняется, в отличие от почты и имени. */
  subject: string;
  email: string | null;
  /** Почту подтвердил сам сервис — только тогда по ней можно найти аккаунт. */
  emailVerified: boolean;
  name: string | null;
  /** Ник в сервисе (у Telegram) — подсказка для ника на площадке. */
  nick: string | null;
}

interface Endpoints {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
}

/**
 * Адреса сервисов. Вне прода OAUTH_TEST_ISSUER подменяет их тестовым
 * сервером — так e2e проходит весь обмен кодом, не ходя в Google и VK.
 */
function endpoints(provider: OAuthProvider): Endpoints {
  const test = process.env.NODE_ENV !== 'production' ? process.env.OAUTH_TEST_ISSUER : undefined;
  if (test) {
    return {
      authorizeUrl: `${test}/${provider}/authorize`,
      tokenUrl: `${test}/${provider}/token`,
      userInfoUrl: `${test}/${provider}/userinfo`,
    };
  }
  return provider === 'google'
    ? {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      }
    : {
        authorizeUrl: 'https://id.vk.com/authorize',
        tokenUrl: 'https://id.vk.com/oauth2/auth',
        userInfoUrl: 'https://id.vk.com/oauth2/user_info',
      };
}

export interface OAuthConfig extends Endpoints {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string | null;
  scope: string;
}

/**
 * Настройки сервиса из окружения; null — сервис не подключён, кнопки нет.
 * Google — GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET; VK ID — VK_CLIENT_ID
 * (обмен кода защищён PKCE, секрет не нужен).
 */
export function oauthConfig(provider: OAuthProvider): OAuthConfig | null {
  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      provider,
      clientId,
      clientSecret,
      scope: 'openid email profile',
      ...endpoints(provider),
    };
  }
  const clientId = process.env.VK_CLIENT_ID;
  if (!clientId) return null;
  return {
    provider,
    clientId,
    clientSecret: process.env.VK_CLIENT_SECRET ?? null,
    scope: 'email',
    ...endpoints(provider),
  };
}

export const isOAuthProvider = (p: string): p is OAuthProvider =>
  (OAUTH_PROVIDERS as readonly string[]).includes(p);

/** PKCE: случайный verifier и его SHA-256 для сервиса. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function authorizeUrl(
  c: OAuthConfig,
  p: { redirectUri: string; state: string; challenge: string },
): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: p.redirectUri,
    scope: c.scope,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    ...(c.provider === 'google' ? { prompt: 'select_account' } : {}),
  });
  return `${c.authorizeUrl}?${q}`;
}

/** Ответ сервиса не тот — вход не состоялся, человек видит понятную причину. */
export class OAuthError extends Error {}

async function postForm(
  url: string,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) throw new OAuthError(`${new URL(url).host} ответил ${res.status}`);
  return body;
}

/** Обмен кода на токен и профиль. device_id — только у VK ID, он приходит в обратном адресе. */
export async function fetchProfile(
  c: OAuthConfig,
  p: { code: string; verifier: string; redirectUri: string; state: string; deviceId?: string },
): Promise<SocialProfile> {
  if (c.provider === 'google') {
    const token = await postForm(c.tokenUrl, {
      grant_type: 'authorization_code',
      code: p.code,
      code_verifier: p.verifier,
      redirect_uri: p.redirectUri,
      client_id: c.clientId,
      client_secret: c.clientSecret ?? '',
    });
    if (typeof token.access_token !== 'string') throw new OAuthError('Google не выдал токен');
    const res = await fetch(c.userInfoUrl, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const u = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !u || typeof u.sub !== 'string') throw new OAuthError('Google не отдал профиль');
    return {
      provider: 'google',
      subject: u.sub,
      email: typeof u.email === 'string' ? u.email.toLowerCase() : null,
      emailVerified: u.email_verified === true,
      name: typeof u.name === 'string' ? u.name : null,
      nick: null,
    };
  }
  if (!p.deviceId) throw new OAuthError('VK ID не передал устройство');
  const token = await postForm(c.tokenUrl, {
    grant_type: 'authorization_code',
    code: p.code,
    code_verifier: p.verifier,
    redirect_uri: p.redirectUri,
    client_id: c.clientId,
    device_id: p.deviceId,
    state: p.state,
  });
  if (typeof token.access_token !== 'string') throw new OAuthError('VK ID не выдал токен');
  const info = await postForm(c.userInfoUrl, {
    client_id: c.clientId,
    access_token: token.access_token,
  });
  const u = info.user as Record<string, unknown> | undefined;
  if (!u || (typeof u.user_id !== 'string' && typeof u.user_id !== 'number')) {
    throw new OAuthError('VK ID не отдал профиль');
  }
  const name = [u.first_name, u.last_name].filter((x) => typeof x === 'string' && x).join(' ');
  return {
    provider: 'vk',
    subject: String(u.user_id),
    email: typeof u.email === 'string' && u.email ? u.email.toLowerCase() : null,
    // Почту VK по ней аккаунт не находим: связать можно вручную в «Безопасности».
    emailVerified: false,
    name: name || null,
    nick: null,
  };
}

/** Данные виджета входа Telegram живут сутки — старые не принимаем. */
const TELEGRAM_MAX_AGE_SEC = 86_400;

/**
 * Проверка данных виджета входа Telegram: подпись — HMAC-SHA256 от
 * отсортированных полей ключом SHA-256(токен бота), как описано в
 * core.telegram.org/widgets/login. Проверяются все пришедшие поля: если
 * Telegram добавит новые, подпись не сломается.
 */
export function verifyTelegramLogin(
  data: Record<string, string | number>,
  botToken: string,
  now = Date.now(),
): SocialProfile | null {
  const { hash, ...fields } = data;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || !botToken) return null;
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const want = createHmac('sha256', secret).update(check).digest('hex');
  if (!timingSafeEqual(Buffer.from(want), Buffer.from(hash))) return null;
  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || now / 1000 - authDate > TELEGRAM_MAX_AGE_SEC) return null;
  if (!/^\d+$/.test(String(fields.id ?? ''))) return null;
  const name = [fields.first_name, fields.last_name].filter(Boolean).join(' ');
  return {
    provider: 'telegram',
    subject: String(fields.id),
    email: null,
    emailVerified: false,
    name: name || null,
    nick: typeof fields.username === 'string' ? fields.username : null,
  };
}
