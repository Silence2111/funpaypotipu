import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface AccessPayload {
  sub: string; // userId
  username: string;
  /** Семейство сеанса (вход на устройстве). У токенов до 13.10 его нет. */
  fam?: string;
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

  /**
   * Токены из писем и состояния входа подписаны тем же ключом, но входом не
   * являются. Раньше ссылка подтверждения почты три дня работала как токен
   * входа в API, а ссылка сброса пароля — час.
   */
  verifyAccess(token: string): AccessPayload {
    const p = this.jwt.verify<AccessPayload & { purpose?: unknown }>(token, { secret: process.env.JWT_ACCESS_SECRET });
    if (p.purpose !== undefined || typeof p.sub !== 'string') throw new Error('Это не токен входа');
    return p;
  }

  verifyRefresh(token: string): RefreshPayload {
    return this.jwt.verify<RefreshPayload>(token, { secret: process.env.JWT_REFRESH_SECRET });
  }

  /**
   * Токен под конкретное действие (сброс пароля, верификация email). `bind` —
   * отпечаток состояния, при котором его выдали: состояние сменилось — токен
   * не действует, поэтому ссылка сброса пароля работает один раз.
   */
  signPurpose(sub: string, purpose: string, ttlSec = 3600, bind?: string): string {
    return this.jwt.sign({ sub, purpose, ...(bind ? { bind } : {}) }, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: ttlSec,
    });
  }

  /** Токен с назначением и отпечатком состояния, с которым его выдали. */
  verifyBound(token: string, purpose: string): { sub: string; bind?: string } {
    const p = this.jwt.verify<{ sub: string; purpose: string; bind?: string }>(token, {
      secret: process.env.JWT_ACCESS_SECRET,
    });
    if (p.purpose !== purpose) throw new Error('Неверное назначение токена');
    return { sub: p.sub, bind: p.bind };
  }

  /**
   * Подписанные данные с назначением: состояние входа через сервис, билет
   * завершения входа. Живут в httpOnly cookie, поэтому подделать или
   * подсмотреть их со страницы нельзя.
   */
  signData(data: Record<string, unknown>, purpose: string, ttlSec: number): string {
    return this.jwt.sign({ data, purpose }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: ttlSec });
  }

  verifyData<T>(token: string, purpose: string): T {
    const p = this.jwt.verify<{ data: T; purpose: string }>(token, { secret: process.env.JWT_ACCESS_SECRET });
    if (p.purpose !== purpose) throw new Error('Неверное назначение токена');
    return p.data;
  }

  verifyPurpose(token: string, purpose: string): string {
    const p = this.jwt.verify<{ sub: string; purpose: string }>(token, {
      secret: process.env.JWT_ACCESS_SECRET,
    });
    if (p.purpose !== purpose) throw new Error('Неверное назначение токена');
    return p.sub;
  }
}
