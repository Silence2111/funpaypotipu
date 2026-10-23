import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

/**
 * Ограничение частоты запросов с одного адреса.
 *
 * Без него регистрацию, письма сброса пароля, создание платежей и
 * сообщения можно было слать без счёта: тысяча аккаунтов за минуту, почта
 * человека, засыпанная письмами, шлюз, отвечающий на мусорные платежи.
 * Подбор пароля и кода уже ограничен по почте (auth/attempts.ts); здесь —
 * по адресу, для всего API.
 *
 * Счётчики — в памяти процесса: у каждой копии API свои, поэтому при двух
 * копиях предел фактически вдвое выше. Адрес — req.ip; за ingress его
 * правильным делает TRUST_PROXY (main.ts). Запросы с самого сервера
 * (loopback) не считаются: так ходят проверки здоровья и e2e. RATE_LIMIT=off
 * выключает ограничение, RATE_LIMIT_SCALE умножает все пределы.
 */
export interface RateRule {
  /** Группа счётчика: «auth-register», «payments»… */
  bucket: string;
  /** Сколько запросов разрешено за окно. */
  points: number;
  /** Окно, секунды. */
  windowSec: number;
}

const RATE_KEY = 'gm:rate-limit';

/** Предел для метода или контроллера; без него — общий предел API. */
export const RateLimit = (bucket: string, points: number, windowSec: number) =>
  SetMetadata(RATE_KEY, { bucket, points, windowSec } satisfies RateRule);

/** Общий предел: 600 запросов в минуту с адреса — человеку не достичь, скрипту — легко. */
export const DEFAULT_RULE: RateRule = { bucket: 'all', points: 600, windowSec: 60 };

interface Window {
  count: number;
  resetAt: number;
}

/** Счётчики с фиксированным окном. Отдельный класс — чтобы проверять без Nest. */
export class RateCounter {
  private readonly windows = new Map<string, Window>();
  private sweptAt = 0;

  /** Сколько секунд ждать, если предел исчерпан; 0 — запрос проходит. */
  hit(key: string, rule: RateRule, now = Date.now()): number {
    this.sweep(now);
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + rule.windowSec * 1000 });
      return 0;
    }
    if (w.count >= rule.points) return Math.max(1, Math.ceil((w.resetAt - now) / 1000));
    w.count += 1;
    return 0;
  }

  /** Раз в минуту выбрасываем истёкшие окна: память не растёт от разовых адресов. */
  private sweep(now: number) {
    if (now - this.sweptAt < 60_000) return;
    this.sweptAt = now;
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
  }

  get size() {
    return this.windows.size;
  }
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

export const isLoopback = (ip: string | undefined) => !ip || LOOPBACK.test(ip);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly counter = new RateCounter();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http' || process.env.RATE_LIMIT === 'off') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (isLoopback(req.ip)) return true;

    const scale = Number(process.env.RATE_LIMIT_SCALE ?? 1) || 1;
    const own = this.reflector.getAllAndOverride<RateRule | undefined>(RATE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Свой предел маршрута и общий — оба: свой не отменяет общий.
    for (const rule of own ? [own, DEFAULT_RULE] : [DEFAULT_RULE]) {
      const scaled = { ...rule, points: Math.ceil(rule.points * scale) };
      const wait = this.counter.hit(`${rule.bucket}:${req.ip}`, scaled);
      if (wait) {
        context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(wait));
        throw new HttpException(
          {
            statusCode: 429,
            message: `Слишком много запросов. Подождите ${wait} сек. и попробуйте снова.`,
            error: 'rate_limited',
          },
          429,
        );
      }
    }
    return true;
  }
}
