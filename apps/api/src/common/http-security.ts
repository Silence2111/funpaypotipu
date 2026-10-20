import type { NextFunction, Request, Response } from 'express';

/**
 * Настройки HTTP для боя: чьим адресам верить, каким сайтам можно ходить в
 * API из браузера, какие заголовки безопасности отдавать.
 */

/**
 * Каким прокси верить в X-Forwarded-For. По умолчанию — локальным и
 * частным сетям: так за nginx-ingress в Kubernetes req.ip — адрес
 * покупателя, а не ingress (иначе лимиты запросов делили бы все на одного).
 * Клиент из интернета подделать заголовок не может: его адрес не частный.
 * TRUST_PROXY=off — не верить никому, число — столько прокси перед API.
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY): boolean | number | string {
  if (!raw) return 'loopback, linklocal, uniquelocal';
  if (raw === 'off' || raw === 'false') return false;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

/** Сайты, которым можно ходить в API из браузера: CORS_ORIGINS, иначе WEB_URL. */
export function allowedOrigins(): string[] {
  const list = (process.env.CORS_ORIGINS ?? process.env.WEB_URL ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s).origin;
      } catch {
        return s;
      }
    });
  // Вне боя — ещё локальный сайт разработчика.
  if (process.env.NODE_ENV !== 'production')
    list.push('http://localhost:3000', 'http://127.0.0.1:3000');
  return [...new Set(list)];
}

/**
 * CORS: запросы без Origin (сервер к серверу, вебхуки, curl) пропускаются,
 * из браузера — только с сайта площадки. Раньше API разрешал любой сайт с
 * cookie, и чужая страница могла читать ответы от имени посетителя.
 */
export function corsOrigin(
  origin: string | undefined,
  done: (err: Error | null, allow?: boolean) => void,
) {
  done(null, !origin || allowedOrigins().includes(origin));
}

/** Заголовки безопасности ответов API. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
