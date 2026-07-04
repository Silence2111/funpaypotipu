'use client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'gm_access';
const USER_KEY = 'gm_user';

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export function setSession(token: string, user: SessionUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event('gm-auth'));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event('gm-auth'));
}

function rawFetch(path: string, opts: RequestInit, token: string | null) {
  return fetch(`${API_URL}/api${path}`, {
    ...opts,
    credentials: 'include', // отправляем httpOnly refresh-cookie
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
}

let refreshing: Promise<string | null> | null = null;

/** Обновление access-токена по refresh-cookie (single-flight). */
async function tryRefresh(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { user: SessionUser; accessToken: string };
      if (data.accessToken && data.user) {
        setSession(data.accessToken, data.user);
        return data.accessToken;
      }
      return null;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** Клиентский запрос к API с access-токеном и автоматическим refresh при 401. */
export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res = await rawFetch(path, opts, token);

  if (res.status === 401 && token) {
    const next = await tryRefresh();
    if (next) {
      res = await rawFetch(path, opts, next);
    } else {
      clearSession();
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (res.status === 204 ? (null as T) : res.json()) as Promise<T>;
}
