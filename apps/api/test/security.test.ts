import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { DEFAULT_RULE, RateCounter, RateLimitGuard, isLoopback } from '../src/common/rate-limit';
import { allowedOrigins, corsOrigin, trustProxySetting } from '../src/common/http-security';

/**
 * Защита перед запуском: лимиты запросов с адреса, CORS только для сайта,
 * доверие прокси. Проверяется: предел и окно, ответ 429 с Retry-After,
 * свой предел маршрута вместе с общим, запросы с самого сервера не
 * считаются; чужой сайт не получает CORS, сервер к серверу — проходит.
 */

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe('счётчик', () => {
  const rule = { bucket: 't', points: 3, windowSec: 60 };

  it('пропускает предел, дальше — сколько ждать', () => {
    const c = new RateCounter();
    expect([c.hit('a', rule, 0), c.hit('a', rule, 1), c.hit('a', rule, 2)]).toEqual([0, 0, 0]);
    expect(c.hit('a', rule, 1000)).toBe(59);
    expect(c.hit('b', rule, 1000)).toBe(0);
  });

  it('новое окно — снова можно; истёкшие окна не копятся', () => {
    const c = new RateCounter();
    for (let i = 0; i < 4; i++) c.hit('a', rule, 0);
    expect(c.hit('a', rule, 60_000)).toBe(0);
    c.hit('old', rule, 0);
    c.hit('x', rule, 200_000);
    expect(c.size).toBe(1);
  });
});

function ctx(ip: string, rule?: object) {
  const headers: Record<string, string> = {};
  const handler = () => undefined;
  if (rule) Reflect.defineMetadata('gm:rate-limit', rule, handler);
  return {
    headers,
    context: {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ ip }),
        getResponse: () => ({ setHeader: (k: string, v: string) => (headers[k] = v) }),
      }),
    } as never,
  };
}

describe('лимит маршрута', () => {
  it('сверх предела — 429, rate_limited и Retry-After', () => {
    const guard = new RateLimitGuard(new Reflector());
    const rule = { bucket: 'auth-forgot', points: 2, windowSec: 900 };
    const { context, headers } = ctx('203.0.113.7', rule);
    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    let thrown: { getStatus(): number; getResponse(): { error: string } } | undefined;
    try {
      guard.canActivate(context);
    } catch (e) {
      thrown = e as typeof thrown;
    }
    expect(thrown?.getStatus()).toBe(429);
    expect(thrown?.getResponse().error).toBe('rate_limited');
    expect(Number(headers['Retry-After'])).toBeGreaterThan(890);
    // Другой адрес — свой счётчик.
    expect(guard.canActivate(ctx('203.0.113.8', rule).context)).toBe(true);
  });

  it('общий предел действует и без своего', () => {
    const guard = new RateLimitGuard(new Reflector());
    const { context } = ctx('198.51.100.1');
    for (let i = 0; i < DEFAULT_RULE.points; i++) guard.canActivate(context);
    expect(() => guard.canActivate(context)).toThrow();
  });

  it('с самого сервера, RATE_LIMIT=off и RATE_LIMIT_SCALE', () => {
    const rule = { bucket: 'r', points: 1, windowSec: 60 };
    const guard = new RateLimitGuard(new Reflector());
    for (let i = 0; i < 5; i++)
      expect(guard.canActivate(ctx('127.0.0.1', rule).context)).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('10.0.0.5')).toBe(false);

    process.env.RATE_LIMIT_SCALE = '3';
    const scaled = ctx('192.0.2.1', rule).context;
    expect([
      guard.canActivate(scaled),
      guard.canActivate(scaled),
      guard.canActivate(scaled),
    ]).toEqual([true, true, true]);
    expect(() => guard.canActivate(scaled)).toThrow();
    process.env.RATE_LIMIT = 'off';
    expect(guard.canActivate(scaled)).toBe(true);
  });
});

describe('CORS и прокси', () => {
  const allow = (origin?: string) => {
    let result: boolean | undefined;
    corsOrigin(origin, (_e, ok) => (result = ok));
    return result;
  };

  it('из браузера — только сайт площадки; без Origin — проходит', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEB_URL = 'https://gamemarket.example/';
    delete process.env.CORS_ORIGINS;
    expect(allowedOrigins()).toEqual(['https://gamemarket.example']);
    expect(allow('https://gamemarket.example')).toBe(true);
    expect(allow('https://evil.example')).toBe(false);
    expect(allow('http://localhost:3000')).toBe(false);
    expect(allow(undefined)).toBe(true);
  });

  it('CORS_ORIGINS — список; вне боя — ещё локальный сайт', () => {
    process.env.NODE_ENV = 'test';
    process.env.CORS_ORIGINS = 'https://a.example, https://b.example';
    expect(allowedOrigins()).toEqual([
      'https://a.example',
      'https://b.example',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ]);
  });

  it('доверие прокси: по умолчанию частные сети, off — никому, число — столько прокси', () => {
    expect(trustProxySetting(undefined)).toBe('loopback, linklocal, uniquelocal');
    expect(trustProxySetting('off')).toBe(false);
    expect(trustProxySetting('2')).toBe(2);
    expect(trustProxySetting('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
});
