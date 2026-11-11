import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, PrismaClient } from '@gamemarket/db';
import {
  ANTIFRAUD_DEFAULTS,
  ANTIFRAUD_KEY,
  STRONG_LINKS,
  antifraudSettings,
  isNewbie,
  type AntifraudSettings,
  type LinkReason,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { utc } from '../../common/sql-time';
import { AuditService } from '../access/audit.service';
import { TrustService } from './trust.service';

/** Браузер и реквизиты считаются за полгода, адрес — за месяц. */
const DEVICE_DAYS = 180;
const IP_DAYS = 30;
const LINKS_MAX = 50;
/** Как часто искать входы с браузера забаненного; e2e — раз в 2 с. */
const SWEEP_MS = Number(process.env.ANTIFRAUD_SWEEP_MS ?? 10 * 60_000);
/** Окно прохода с запасом: пропущенный проход не теряет входы. */
const SWEEP_LOOKBACK_MS = Math.max(SWEEP_MS * 3, 60 * 60_000);

/**
 * В e2e лимиты по умолчанию выключены (`ANTIFRAUD_DEFAULTS=off`): сценарии
 * платят и выставляют лоты свежими аккаунтами. Сценарий части 128 включает
 * их настройкой в консоли и проверяет.
 */
const DEFAULTS: AntifraudSettings =
  process.env.ANTIFRAUD_DEFAULTS === 'off' ? { ...ANTIFRAUD_DEFAULTS, enabled: false } : ANTIFRAUD_DEFAULTS;

export interface LinkedAccount {
  userId: string;
  username: string | null;
  status: string;
  reasons: LinkReason[];
}

const antifraudError = (status: number, error: string, message: string) => new HttpException({ statusCode: status, error, message }, status);

/**
 * Защита от мошенничества (часть 128, docs/06): лимиты новичков, частота
 * оплат, связанные аккаунты (общий браузер, реквизиты вывода, адрес) и
 * запрет сделок между ними. Каждый отказ — сигнал риска с причиной: в
 * консоли видно, почему человека остановили.
 */
@Injectable()
export class AntifraudService {
  private readonly logger = new Logger(AntifraudService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly trust: TrustService,
    private readonly audit: AuditService,
  ) {}

  async settings(): Promise<AntifraudSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: ANTIFRAUD_KEY } });
    return antifraudSettings(row?.value, DEFAULTS);
  }

  /** Сохранённые настройки и признак «по умолчанию» — для консоли. */
  async view() {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: ANTIFRAUD_KEY } });
    return { ...antifraudSettings(row?.value, DEFAULTS), saved: !!row };
  }

  async save(value: AntifraudSettings, actorId: string) {
    const before = await this.settings();
    const clean = antifraudSettings(value, DEFAULTS);
    await this.prisma.systemSetting.upsert({
      where: { key: ANTIFRAUD_KEY },
      create: { key: ANTIFRAUD_KEY, value: clean as unknown as Prisma.InputJsonValue },
      update: { value: clean as unknown as Prisma.InputJsonValue },
    });
    await this.audit.log({
      actorId,
      action: 'settings.antifraud',
      entityType: 'setting',
      entityId: ANTIFRAUD_KEY,
      before: before as unknown as Prisma.InputJsonValue,
      after: clean as unknown as Prisma.InputJsonValue,
    });
    return { ...clean, saved: true };
  }

  /** Вернуть значения по умолчанию (e2e убирает за собой). */
  async reset(actorId: string) {
    await this.prisma.systemSetting.deleteMany({ where: { key: ANTIFRAUD_KEY } });
    await this.audit.log({ actorId, action: 'settings.antifraud_reset', entityType: 'setting', entityId: ANTIFRAUD_KEY });
    return this.view();
  }

  /** Новичок: моложе 72 ч и ни одной завершённой сделки — ни покупки, ни продажи. */
  async newbie(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    if (!user) return false;
    const done = await this.prisma.order.count({
      where: { status: 'completed', OR: [{ buyerId: userId }, { sellerId: userId }] },
      take: 1,
    });
    return isNewbie(user.createdAt, done);
  }

  /**
   * Перед оплатой картой или СБП: частота попыток (у всех) и сумма за сутки
   * (у новичка) — так ведут себя краденые карты: много быстрых попыток и
   * всё, что пройдёт, сразу в ключи.
   */
  async assertCanPay(userId: string, amount: bigint) {
    const s = await this.settings();
    if (!s.enabled) return;
    const newbie = await this.newbie(userId);
    const hourAgo = new Date(Date.now() - 3_600_000);
    const tries = await this.prisma.payment.count({ where: { userId, createdAt: { gte: hourAgo } } });
    const perHour = newbie ? s.newbiePaymentsPerHour : s.paymentsPerHour;
    if (tries >= perHour) {
      await this.signal(userId, 'velocity', 10, { what: 'payments_per_hour', tries, limit: perHour, newbie });
      throw antifraudError(429, 'payments_too_often', `Слишком много попыток оплаты за час — не больше ${perHour}. Попробуйте позже или напишите в поддержку.`);
    }
    if (!newbie) return;
    const dayAgo = new Date(Date.now() - 86_400_000);
    const paid = await this.prisma.payment.aggregate({
      where: { userId, status: 'succeeded', createdAt: { gte: dayAgo } },
      _sum: { amount: true },
    });
    const total = (paid._sum.amount ?? 0n) + amount;
    if (total > BigInt(s.newbiePayDay)) {
      await this.signal(userId, 'velocity', 5, { what: 'newbie_pay_day', total: total.toString(), limit: s.newbiePayDay });
      const rub = new Intl.NumberFormat('ru-RU').format(s.newbiePayDay / 100);
      throw antifraudError(
        403,
        'newbie_pay_limit',
        `Новым аккаунтам — до ${rub} ₽ оплат картой и по СБП за сутки. Ограничение снимется после первой завершённой сделки или через 3 дня после регистрации.`,
      );
    }
  }

  /** Перед новым лотом: новичок — не больше N лотов за сутки (спам и подставные витрины). */
  async assertCanList(sellerId: string, adding = 1) {
    const s = await this.settings();
    if (!s.enabled || !(await this.newbie(sellerId))) return;
    const dayAgo = new Date(Date.now() - 86_400_000);
    const made = await this.prisma.listing.count({ where: { sellerId, createdAt: { gte: dayAgo } } });
    if (made + adding > s.newbieLotsPerDay) {
      await this.signal(sellerId, 'velocity', 5, { what: 'newbie_lots_day', made, adding, limit: s.newbieLotsPerDay });
      throw antifraudError(
        429,
        'newbie_lot_limit',
        `Новым продавцам — до ${s.newbieLotsPerDay} лотов за сутки. Ограничение снимется после первой завершённой сделки или через 3 дня после регистрации.`,
      );
    }
  }

  /**
   * Сделка между аккаунтами одного человека — общий браузер или общие
   * реквизиты вывода: накрутка отзывов и продаж, кэшбэк с самого себя,
   * отмыв. Общий адрес IP не в счёт — мобильные сети и общий Wi‑Fi.
   */
  async assertNotLinked(buyerId: string, sellerId: string) {
    const s = await this.settings();
    if (!s.enabled || !s.blockLinkedDeals) return;
    const reasons = await this.strongLinks(buyerId, sellerId);
    if (!reasons.length) return;
    await this.signal(buyerId, 'multiaccount', 20, { what: 'linked_deal', with: sellerId, reasons });
    await this.signal(sellerId, 'multiaccount', 20, { what: 'linked_deal', with: buyerId, reasons });
    throw antifraudError(
      409,
      'linked_accounts',
      'Покупка недоступна: аккаунты покупателя и продавца связаны — общий браузер или реквизиты вывода. Если это ошибка, напишите в поддержку.',
    );
  }

  /**
   * Вывод на реквизиты, которые были у забаненного аккаунта, — обход бана.
   * Заявка не создаётся, сотрудник видит сигнал.
   */
  async assertRequisitesClean(userId: string, method: string, fp: string) {
    const s = await this.settings();
    if (!s.enabled || method === 'card') return;
    const banned = await this.prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT DISTINCT x.user_id FROM (
        SELECT user_id FROM payouts WHERE destination_fp = ${fp} AND method <> 'card'
        UNION SELECT user_id FROM payout_destinations WHERE fingerprint = ${fp} AND method <> 'card'
      ) x JOIN users u ON u.id = x.user_id
      WHERE x.user_id <> ${userId}::uuid AND u.status = 'banned'
      LIMIT 1`;
    if (!banned.length) return;
    await this.signal(userId, 'multiaccount', 50, { what: 'banned_requisites', banned: banned[0]!.user_id });
    throw antifraudError(
      403,
      'requisites_blocked',
      'Вывод на эти реквизиты недоступен: они связаны с заблокированным аккаунтом. Напишите в поддержку.',
    );
  }

  /**
   * Входы с браузера, где входил забаненный, — сигнал сотрудникам (обход
   * бана); сам вход не запрещаем. Фоновой задачей, а не во входе: модуль
   * входа не зависит от антифрода, и вход не ждёт лишний запрос.
   */
  @Interval('antifraud-banned-devices', SWEEP_MS)
  async sweepBannedDevices() {
    const since = new Date(Date.now() - SWEEP_LOOKBACK_MS);
    const deviceSince = new Date(Date.now() - DEVICE_DAYS * 86_400_000);
    const rows = await this.prisma.$queryRaw<Array<{ user_id: string; banned: string }>>`
      SELECT DISTINCT s.user_id, b.user_id AS banned
      FROM auth_sessions s
      JOIN auth_sessions b ON b.device_fingerprint = s.device_fingerprint AND b.user_id <> s.user_id
      JOIN users bu ON bu.id = b.user_id AND bu.status = 'banned'
      JOIN users su ON su.id = s.user_id AND su.status <> 'banned'
      WHERE s.created_at >= ${utc(since)} AND b.created_at >= ${utc(deviceSince)} AND s.device_fingerprint IS NOT NULL
      LIMIT 200`;
    for (const r of rows) {
      const already = await this.prisma.riskSignal.count({
        where: { userId: r.user_id, type: 'multiaccount', payload: { path: ['banned'], equals: r.banned } },
        take: 1,
      });
      if (!already) await this.signal(r.user_id, 'multiaccount', 30, { what: 'banned_device', banned: r.banned });
    }
  }

  /** Сильные связи двух аккаунтов: общий браузер, общие реквизиты (не карта). */
  async strongLinks(a: string, b: string): Promise<LinkReason[]> {
    if (a === b) return [];
    const since = new Date(Date.now() - DEVICE_DAYS * 86_400_000);
    const [device, requisites] = await Promise.all([
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT 1 AS n FROM auth_sessions s1 JOIN auth_sessions s2 ON s2.device_fingerprint = s1.device_fingerprint
        WHERE s1.user_id = ${a}::uuid AND s2.user_id = ${b}::uuid AND s1.device_fingerprint IS NOT NULL
          AND s1.created_at >= ${utc(since)} AND s2.created_at >= ${utc(since)}
        LIMIT 1`,
      this.prisma.$queryRaw<Array<{ n: number }>>`
        WITH fa AS (
          SELECT destination_fp AS fp FROM payouts WHERE user_id = ${a}::uuid AND destination_fp IS NOT NULL AND method <> 'card'
          UNION SELECT fingerprint FROM payout_destinations WHERE user_id = ${a}::uuid AND method <> 'card'
        ), fb AS (
          SELECT destination_fp AS fp FROM payouts WHERE user_id = ${b}::uuid AND destination_fp IS NOT NULL AND method <> 'card'
          UNION SELECT fingerprint FROM payout_destinations WHERE user_id = ${b}::uuid AND method <> 'card'
        )
        SELECT 1 AS n FROM fa JOIN fb ON fa.fp = fb.fp LIMIT 1`,
    ]);
    const out: LinkReason[] = [];
    if (device.length) out.push('device');
    if (requisites.length) out.push('requisites');
    return out.filter((r) => STRONG_LINKS.includes(r));
  }

  /**
   * Связанные аккаунты для консоли: общий браузер и реквизиты (полгода),
   * общий адрес IP (месяц, слабая связь). Карта — только по маске, поэтому
   * в «реквизитах» её нет: совпадение первых и последних цифр бывает у
   * разных людей.
   */
  async links(userId: string): Promise<LinkedAccount[]> {
    const since = new Date(Date.now() - DEVICE_DAYS * 86_400_000);
    const ipSince = new Date(Date.now() - IP_DAYS * 86_400_000);
    const rows = await this.prisma.$queryRaw<Array<{ user_id: string; reason: LinkReason }>>`
      SELECT DISTINCT s2.user_id, 'device' AS reason
        FROM auth_sessions s1 JOIN auth_sessions s2 ON s2.device_fingerprint = s1.device_fingerprint
        WHERE s1.user_id = ${userId}::uuid AND s2.user_id <> ${userId}::uuid AND s1.device_fingerprint IS NOT NULL
          AND s1.created_at >= ${utc(since)} AND s2.created_at >= ${utc(since)}
      UNION
      SELECT DISTINCT o.user_id, 'requisites' AS reason FROM (
          SELECT destination_fp AS fp FROM payouts WHERE user_id = ${userId}::uuid AND destination_fp IS NOT NULL AND method <> 'card'
          UNION SELECT fingerprint FROM payout_destinations WHERE user_id = ${userId}::uuid AND method <> 'card'
        ) mine JOIN (
          SELECT user_id, destination_fp AS fp FROM payouts WHERE destination_fp IS NOT NULL AND method <> 'card'
          UNION SELECT user_id, fingerprint FROM payout_destinations WHERE method <> 'card'
        ) o ON o.fp = mine.fp
        WHERE o.user_id <> ${userId}::uuid
      UNION
      SELECT DISTINCT s2.user_id, 'ip' AS reason
        FROM auth_sessions s1 JOIN auth_sessions s2 ON s2.ip = s1.ip
        WHERE s1.user_id = ${userId}::uuid AND s2.user_id <> ${userId}::uuid AND s1.ip IS NOT NULL
          -- Запросы с самого сервера (проверки, e2e) — не адрес человека.
          AND s1.ip NOT IN ('127.0.0.1', '::1', '::ffff:127.0.0.1')
          AND s1.created_at >= ${utc(ipSince)} AND s2.created_at >= ${utc(ipSince)}
      LIMIT ${LINKS_MAX * 3}`;
    const byUser = new Map<string, Set<LinkReason>>();
    for (const r of rows) byUser.set(r.user_id, (byUser.get(r.user_id) ?? new Set()).add(r.reason));
    const ids = [...byUser.keys()].slice(0, LINKS_MAX);
    if (!ids.length) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, profile: { select: { username: true } } },
    });
    const order: LinkReason[] = ['device', 'requisites', 'ip'];
    return users
      .map((u) => ({
        userId: u.id,
        username: u.profile?.username ?? null,
        status: u.status,
        reasons: order.filter((r) => byUser.get(u.id)!.has(r)),
      }))
      // Сначала сильные связи и забаненные — с ними сотруднику работать первым.
      .sort(
        (x, y) =>
          Number(STRONG_LINKS.includes(y.reasons[0]!)) - Number(STRONG_LINKS.includes(x.reasons[0]!)) ||
          Number(y.status === 'banned') - Number(x.status === 'banned'),
      );
  }

  private async signal(userId: string, type: 'velocity' | 'multiaccount', score: number, payload: Record<string, unknown>) {
    await this.trust
      .record(userId, type, score, payload as Prisma.InputJsonValue)
      .catch((e: Error) => this.logger.warn(`Сигнал риска ${type} ${userId}: ${e.message}`));
  }
}
