import { CanActivate, ExecutionContext, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiKeysService } from './api-keys.service';
import { ctxOf } from '../auth/auth-http';

export interface ApiUser {
  userId: string;
  keyId: string;
}

/**
 * Вход по ключу API (часть 127): `Authorization: Bearer gm_live_…` или
 * `X-Api-Key`. Лимит — 60 запросов в минуту на ключ (429 и Retry-After),
 * каждый запрос — в журнал с ответом и временем.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly keys: ApiKeysService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { apiUser?: ApiUser }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const header = req.headers.authorization;
    const raw =
      (typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined) ??
      (typeof req.headers['x-api-key'] === 'string' ? (req.headers['x-api-key'] as string) : undefined);
    const who = raw ? await this.keys.authenticate(raw.trim()) : null;
    if (!who) throw new UnauthorizedException('Нужен действующий ключ API: «Инструменты» → «API»');

    const started = Date.now();
    res.on('finish', () =>
      this.keys.log({
        keyId: who.keyId,
        method: req.method,
        path: req.originalUrl ?? req.url,
        status: res.statusCode,
        ip: ctxOf(req).ip,
        durationMs: Date.now() - started,
      }),
    );
    const wait = this.keys.hit(who.keyId);
    if (wait) {
      res.setHeader('Retry-After', String(wait));
      throw new HttpException(
        { statusCode: 429, message: `Не больше 60 запросов в минуту на ключ. Подождите ${wait} сек.`, error: 'rate_limited', retryAfter: wait },
        429,
      );
    }
    req.apiUser = who;
    return true;
  }
}
