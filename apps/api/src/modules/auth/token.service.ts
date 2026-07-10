import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface AccessPayload {
  sub: string; // userId
  username: string;
}

export interface RefreshPayload {
  sub: string; // userId
  sid: string; // session id
}

/** Подпись и верификация JWT. Access — короткий, refresh — длинный с привязкой к сессии. */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccess(payload: AccessPayload): string {
    return this.jwt.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: Number(process.env.JWT_ACCESS_TTL ?? 900),
    });
  }

  signRefresh(payload: RefreshPayload): string {
    return this.jwt.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: Number(process.env.JWT_REFRESH_TTL ?? 2592000),
    });
  }

  verifyAccess(token: string): AccessPayload {
    return this.jwt.verify<AccessPayload>(token, { secret: process.env.JWT_ACCESS_SECRET });
  }

  verifyRefresh(token: string): RefreshPayload {
    return this.jwt.verify<RefreshPayload>(token, { secret: process.env.JWT_REFRESH_SECRET });
  }

  /** Одноразовый токен под конкретное действие (сброс пароля, верификация email). */
  signPurpose(sub: string, purpose: string, ttlSec = 3600): string {
    return this.jwt.sign({ sub, purpose }, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: ttlSec,
    });
  }

  verifyPurpose(token: string, purpose: string): string {
    const p = this.jwt.verify<{ sub: string; purpose: string }>(token, {
      secret: process.env.JWT_ACCESS_SECRET,
    });
    if (p.purpose !== purpose) throw new Error('Неверное назначение токена');
    return p.sub;
  }
}
