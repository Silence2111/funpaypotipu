import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, type RiskSignalType } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

const WINDOW_DAYS = 30;

@Injectable()
export class TrustService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Зафиксировать сигнал риска (используется другими модулями). */
  record(userId: string, type: RiskSignalType, score: number, payload?: Prisma.InputJsonValue) {
    return this.prisma.riskSignal.create({ data: { userId, type, score, payload } });
  }

  listSignals(userId: string, limit = 100) {
    return this.prisma.riskSignal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Суммарный риск-балл за окно. Влияет на холды выплат/капчу/очередь модерации. */
  async riskScore(userId: string): Promise<{ userId: string; score: number; signals: number }> {
    const since = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000);
    const rows = await this.prisma.riskSignal.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { score: true },
    });
    const score = rows.reduce((a, r) => a + r.score, 0);
    return { userId, score, signals: rows.length };
  }
}
