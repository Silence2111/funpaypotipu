import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaClient } from '@gamemarket/db';
import {
  REGISTRY_DAILY_USERS,
  REGISTRY_SELLERS,
  REGISTRY_TURNOVER_MINOR,
  registryStanding,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { utc } from '../../common/sql-time';

const KEY = 'registry_check';
const MSK_MS = 3 * 3600_000;
/** Проход раз в 12 ч: в январе считает прошлый год один раз. */
const CHECK_MS = Number(process.env.REGISTRY_CHECK_MS ?? 12 * 3600_000);

interface Measured {
  year: number;
  sellers: number;
  turnover: string;
  sellersShare: number;
  turnoverShare: number;
  near: boolean;
  reached: boolean;
}

/**
 * Пороги реестра по 289-ФЗ (часть 145): каждый январь площадка считает
 * прошлый год — продавцов со сделками и оборот — и пишет администраторам,
 * где она относительно порогов. Подходит к порогу — пора готовить то, что
 * закон требует от платформы из реестра (`ПРОДУКТ/289-ФЗ.md`). Пользователей
 * в день площадка не считает — это Метрика, в итогах напоминание о ней.
 */
@Injectable()
export class RegistryCheckService {
  private readonly logger = new Logger(RegistryCheckService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
  ) {}

  /** Год по Москве: продавцы с завершёнными сделками и их сумма. */
  async measure(year: number, until?: Date): Promise<Measured> {
    const from = new Date(Date.UTC(year, 0, 1) - MSK_MS);
    const to = until ?? new Date(Date.UTC(year + 1, 0, 1) - MSK_MS);
    const [row] = await this.prisma.$queryRaw<Array<{ sellers: bigint; turnover: bigint | null }>>`
      SELECT COUNT(DISTINCT "seller_id") AS sellers, SUM("amount") AS turnover
      FROM "orders"
      WHERE "status" = 'completed' AND "completed_at" >= ${utc(from)} AND "completed_at" < ${utc(to)}`;
    const sellers = Number(row?.sellers ?? 0);
    const turnover = BigInt(row?.turnover ?? 0);
    return { year, sellers, turnover: turnover.toString(), ...registryStanding(sellers, turnover) };
  }

  @Interval('registry-check', CHECK_MS)
  async sweep(now = new Date()) {
    try {
      const msk = new Date(now.getTime() + MSK_MS);
      if (msk.getUTCMonth() !== 0) return;
      await this.check(msk.getUTCFullYear() - 1, now);
    } catch (e) {
      this.logger.error(`Пороги реестра: ${(e as Error).message}`);
    }
  }

  /** Итоги года — один раз: записать и написать администраторам. */
  async check(year: number, now = new Date()) {
    const last = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
    if ((last?.value as { year?: number } | null)?.year === year) return null;
    const m = await this.measure(year);
    await this.prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { ...m, checkedAt: now.toISOString() } },
      update: { value: { ...m, checkedAt: now.toISOString() } },
    });
    const admins = await this.prisma.user.findMany({
      where: { status: 'active', roles: { some: { role: { key: 'admin' } } } },
      select: { id: true },
    });
    for (const a of admins) {
      await this.notifications
        .notify(a.id, 'registry_check', { year, sellers: m.sellers, turnover: m.turnover, near: m.near, reached: m.reached })
        .catch(() => null);
    }
    if (m.near) this.logger.warn(`289-ФЗ: за ${year} год площадка у порога реестра — готовить требования закона`);
    return m;
  }

  /** Для консоли: итоги прошлого года и текущий год на сегодня. */
  async status(now = new Date()) {
    const msk = new Date(now.getTime() + MSK_MS);
    const last = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
    return {
      thresholds: { dailyUsers: REGISTRY_DAILY_USERS, sellers: REGISTRY_SELLERS, turnover: REGISTRY_TURNOVER_MINOR.toString() },
      last: last?.value ?? null,
      current: await this.measure(msk.getUTCFullYear(), now),
    };
  }
}
