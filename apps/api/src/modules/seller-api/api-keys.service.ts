import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@gamemarket/db';
import { API_KEY_PREFIX, API_KEYS_MAX, API_LOG_DAYS, API_RATE_PER_MIN } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
/** Лимит на ключ: окно — минута; в e2e можно сузить (`SELLER_API_RATE_PER_MIN`). */
const RATE = Number(process.env.SELLER_API_RATE_PER_MIN ?? API_RATE_PER_MIN);

/**
 * Ключи API продавца (часть 127). Ключ — `gm_live_` и 32 случайных байта;
 * показывается один раз, в базе — SHA-256 и первые знаки. Отозванный ключ
 * перестаёт работать сразу. Журнал запросов — 30 дней.
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);
  /** Окна лимита по ключам: начало минуты и число запросов. */
  private readonly windows = new Map<string, { start: number; n: number }>();

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(userId: string) {
    return this.prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
    });
  }

  async create(userId: string, name: string) {
    const active = await this.prisma.apiKey.count({ where: { userId, revokedAt: null } });
    if (active >= API_KEYS_MAX) {
      throw new BadRequestException(`Не больше ${API_KEYS_MAX} ключей — отзовите ненужный`);
    }
    const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const row = await this.prisma.apiKey.create({
      data: { userId, name: name.trim().slice(0, 60), prefix: key.slice(0, 14), keyHash: sha256(key) },
      select: { id: true, name: true, prefix: true, createdAt: true },
    });
    return { ...row, key };
  }

  async revoke(userId: string, id: string) {
    const done = await this.prisma.apiKey.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!done.count) throw new NotFoundException('Ключ не найден');
    return this.list(userId);
  }

  /** Ключ из заголовка → продавец; неизвестный, отозванный, удалённый или заблокированный — null. */
  async authenticate(raw: string): Promise<{ keyId: string; userId: string } | null> {
    if (!raw.startsWith(API_KEY_PREFIX)) return null;
    const row = await this.prisma.apiKey.findUnique({
      where: { keyHash: sha256(raw) },
      select: { id: true, userId: true, revokedAt: true, lastUsedAt: true },
    });
    if (!row || row.revokedAt) return null;
    const user = await this.prisma.user.findUnique({ where: { id: row.userId }, select: { status: true, deletedAt: true } });
    if (!user || user.status === 'banned' || user.deletedAt) return null;
    // «Последний раз» — не чаще раза в минуту: не писать в базу на каждый запрос.
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await this.prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return { keyId: row.id, userId: row.userId };
  }

  /** Лимит запросов на ключ: сколько секунд ждать, или 0 — можно. */
  hit(keyId: string, now = Date.now()): number {
    const w = this.windows.get(keyId);
    if (!w || now - w.start >= 60_000) {
      this.windows.set(keyId, { start: now, n: 1 });
      return 0;
    }
    if (w.n >= RATE) return Math.ceil((w.start + 60_000 - now) / 1000);
    w.n += 1;
    return 0;
  }

  log(entry: { keyId: string; method: string; path: string; status: number; ip?: string | null; durationMs: number }) {
    void this.prisma.apiRequest
      .create({
        data: {
          keyId: entry.keyId,
          method: entry.method.slice(0, 8),
          path: entry.path.split('?')[0]!.slice(0, 200),
          status: entry.status,
          ip: entry.ip?.slice(0, 64) ?? null,
          durationMs: Math.min(entry.durationMs, 2_000_000_000),
        },
      })
      .catch((e: Error) => this.logger.warn(`Журнал API: ${e.message}`));
  }

  /** Журнал запросов продавца — последние 50 по всем ключам. */
  async requests(userId: string) {
    return this.prisma.apiRequest.findMany({
      where: { key: { userId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, method: true, path: true, status: true, ip: true, durationMs: true, createdAt: true, key: { select: { name: true, prefix: true } } },
    });
  }

  @Interval('api-requests-prune', 6 * 3600_000)
  async prune() {
    await this.prisma.apiRequest
      .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - API_LOG_DAYS * 24 * 3600_000) } } })
      .catch(() => undefined);
    // Окна лимита старше минуты — не нужны.
    const now = Date.now();
    for (const [k, w] of this.windows) if (now - w.start > 60_000) this.windows.delete(k);
  }
}
