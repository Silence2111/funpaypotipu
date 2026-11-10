import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PD_CONSENT_VERSION } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import type { RequestCtx } from '../auth/auth.service';

const SELECT = { version: true, method: true, givenAt: true, revokedAt: true } as const;

/**
 * Согласие на обработку персональных данных в кабинете (часть 120): что
 * дано и когда, повторное согласие — у аккаунтов до части 120 и после
 * отзыва, отзыв. Каждое согласие и отзыв — запись с датой и адресом.
 */
@Injectable()
export class ConsentService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async status(userId: string) {
    const rows = await this.prisma.personalDataConsent.findMany({
      where: { userId },
      orderBy: { givenAt: 'desc' },
      take: 10,
      select: SELECT,
    });
    const active = rows.find((r) => !r.revokedAt) ?? null;
    return {
      // Действующая редакция текста: согласие на старую — повод спросить заново.
      version: PD_CONSENT_VERSION,
      active: active
        ? { version: active.version, method: active.method, givenAt: active.givenAt, current: active.version === PD_CONSENT_VERSION }
        : null,
      history: rows,
    };
  }

  /** Дать согласие из кабинета: старые аккаунты, после отзыва, новая редакция. */
  async give(userId: string, ctx: RequestCtx) {
    const now = await this.status(userId);
    if (now.active?.current) return now;
    await this.prisma.$transaction([
      // Согласие на старую редакцию заменяется новым — действует одно.
      this.prisma.personalDataConsent.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeIp: ctx.ip?.slice(0, 64) ?? null },
      }),
      this.prisma.personalDataConsent.create({
        data: {
          userId,
          version: PD_CONSENT_VERSION,
          method: 'account',
          ip: ctx.ip?.slice(0, 64) ?? null,
          userAgent: ctx.userAgent?.slice(0, 300) ?? null,
        },
      }),
    ]);
    return this.status(userId);
  }

  /** Отозвать: запись остаётся с датой и адресом отзыва. */
  async revoke(userId: string, ctx: RequestCtx) {
    await this.prisma.personalDataConsent.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeIp: ctx.ip?.slice(0, 64) ?? null },
    });
    return this.status(userId);
  }
}
