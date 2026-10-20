import type { Request, Response } from 'express';
import type { AuthResponse } from '@gamemarket/shared';
import type { IssuedAuth, RequestCtx } from './auth.service';

export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_PATH = '/api/auth';

/** Refresh — в httpOnly cookie, access — в теле ответа. */
export function completeLogin(issued: IssuedAuth, res: Response): AuthResponse {
  res.cookie(REFRESH_COOKIE, issued.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_PATH,
    maxAge: Number(process.env.JWT_REFRESH_TTL ?? 2592000) * 1000,
  });
  return { user: issued.user, accessToken: issued.accessToken };
}

export function ctxOf(req: Request): RequestCtx {
  return {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
    fingerprint: (req.headers['x-device-fingerprint'] as string | undefined) ?? undefined,
  };
}
