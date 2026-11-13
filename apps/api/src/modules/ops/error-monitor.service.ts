import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { utc } from '../../common/sql-time';
import { fingerprint, normalizeMessage } from './fingerprint';
import { setOpsSink, type OpsErrorInput, type OpsEventKind } from './ops-signal';

/** Сколько разных групп и событий копится между сбросами — больше не держим. */
const MAX_GROUPS = 200;
const MAX_EVENTS = 1000;

interface Pending {
  input: OpsErrorInput;
  count: number;
  at: Date;
}

/**
 * Сбор ошибок API и сайта (часть 130) — свой маленький GlitchTip: данные
 * остаются на нашем сервере. Ошибки копятся в памяти и раз в несколько
 * секунд пишутся в базу одной пачкой: при всплеске база получает не тысячу
 * запросов, а по одному на вид ошибки. Группы — `error_groups`, отметки
 * времени для правил тревог — `ops_events`.
 */
@Injectable()
export class ErrorMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErrorMonitorService.name);
  private groups = new Map<string, Pending>();
  private events: Array<{ kind: string; at: Date }> = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  onModuleInit() {
    setOpsSink({ error: (i) => this.error(i), event: (k) => this.event(k) });
    const every = Number(process.env.OPS_FLUSH_MS ?? 5000);
    this.timer = setInterval(() => void this.flush(), every);
    this.timer.unref();
  }

  async onModuleDestroy() {
    setOpsSink(null);
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  error(input: OpsErrorInput) {
    const fp = fingerprint(input.source, input.message, input.stack, input.context);
    const g = this.groups.get(fp);
    if (g) {
      g.count++;
      g.at = new Date();
    } else if (this.groups.size < MAX_GROUPS) {
      this.groups.set(fp, { input, count: 1, at: new Date() });
    }
    if (input.source === 'api') this.push('error');
  }

  event(kind: OpsEventKind) {
    this.push(kind);
  }

  private push(kind: string) {
    if (this.events.length < MAX_EVENTS) this.events.push({ kind, at: new Date() });
  }

  /** Записать накопленное. Ошибки записи — только в журнал процесса: иначе петля. */
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    const groups = this.groups;
    const events = this.events;
    this.groups = new Map();
    this.events = [];
    try {
      for (const [fp, g] of groups) {
        const i = g.input;
        await this.prisma.$executeRaw`
          INSERT INTO error_groups (id, fingerprint, source, message, context, stack, path, count, first_seen_at, last_seen_at)
          VALUES (gen_random_uuid(), ${fp}, ${i.source}, ${i.message.slice(0, 2000)}, ${i.context?.slice(0, 200) ?? null},
                  ${i.stack?.slice(0, 8000) ?? null}, ${i.path?.slice(0, 300) ?? null}, ${g.count},
                  ${utc(g.at)}, ${utc(g.at)})
          ON CONFLICT (fingerprint) DO UPDATE SET
            count = error_groups.count + EXCLUDED.count,
            last_seen_at = EXCLUDED.last_seen_at,
            path = COALESCE(EXCLUDED.path, error_groups.path),
            stack = COALESCE(error_groups.stack, EXCLUDED.stack),
            resolved_at = NULL`;
      }
      if (events.length) await this.prisma.opsEvent.createMany({ data: events });
    } catch (e) {
      this.logger.warn(`Ошибки не записались: ${(e as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }

  /** Группы ошибок для консоли: открытые сверху, по времени последнего раза. */
  async list(opts: { resolved?: boolean; limit?: number } = {}) {
    const rows = await this.prisma.errorGroup.findMany({
      where: { resolvedAt: opts.resolved ? { not: null } : null },
      orderBy: { lastSeenAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 200),
    });
    return rows.map((r) => ({ ...r, title: normalizeMessage(r.message) }));
  }

  resolve(id: string) {
    return this.prisma.errorGroup.update({ where: { id }, data: { resolvedAt: new Date() } });
  }
}
