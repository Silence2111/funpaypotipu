import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient, type Order } from '@gamemarket/db';
import {
  PARTNER_ATTACH_HOURS,
  PARTNER_SETTINGS_KEY,
  partnerRewardToBalance,
  dealEconomics,
  newPartnerCode,
  normalizePartnerCode,
  partnerActive,
  partnerSettings,
  partnerShare,
  withinPartnerTerm,
  type PartnerSettings,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../access/audit.service';

/** За сколько дней сеансы партнёра сверяются с новым пользователем. */
const SAME_PERSON_DAYS = 30;
const DAY = 24 * 3600_000;

export type AttachResult = { attached: true } | { attached: false; reason: string };

/**
 * Партнёрская программа (часть 116) — механизм без цифр: долю и срок задаёт
 * администратор, по умолчанию выключена. Партнёр приводит людей ссылкой или
 * кодом; с каждой завершённой сделки привлечённого в срок ему уходит доля
 * того, что осталось площадке после эквайринга и кэшбэка, — на баланс,
 * вывод обычный. Себя не привести: тот же IP или устройство, что у партнёра,
 * и сделки с самим партнёром не в счёт.
 */
@Injectable()
export class PartnersService {
  private readonly logger = new Logger(PartnersService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async settings(): Promise<PartnerSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: PARTNER_SETTINGS_KEY } });
    return partnerSettings(row?.value);
  }

  /** Публично: работает ли программа и на каких условиях. */
  async program() {
    const s = await this.settings();
    return { active: partnerActive(s), shareBps: s.shareBps, termDays: s.termDays };
  }

  // ── Консоль ──

  async setSettings(actorId: string, next: PartnerSettings) {
    if (next.enabled && (next.shareBps <= 0 || next.termDays <= 0)) {
      throw new BadRequestException('Чтобы включить программу, задайте долю и срок больше нуля');
    }
    const before = await this.settings();
    const value = { ...next, setBy: actorId, setAt: new Date().toISOString() };
    await this.prisma.systemSetting.upsert({
      where: { key: PARTNER_SETTINGS_KEY },
      update: { value },
      create: { key: PARTNER_SETTINGS_KEY, value },
    });
    await this.audit.log({
      actorId,
      action: 'partner.settings',
      entityType: 'setting',
      entityId: PARTNER_SETTINGS_KEY,
      before: { ...before },
      after: { ...next },
    });
    return this.adminView();
  }

  /** Для консоли: условия и итог программы. */
  async adminView() {
    const [settings, partners, referred, sums] = await Promise.all([
      this.settings(),
      this.prisma.partner.count(),
      this.prisma.user.count({ where: { referredById: { not: null } } }),
      this.prisma.partnerAccrual.aggregate({ _count: true, _sum: { amount: true } }),
    ]);
    return {
      settings,
      active: partnerActive(settings),
      totals: { partners, referred, deals: sums._count, accrued: (sums._sum.amount ?? 0n).toString() },
    };
  }

  // ── Партнёр ──

  /** Кабинет партнёра: код, ссылка и итоги. Код выдаётся, когда программа работает. */
  async me(userId: string) {
    const s = await this.settings();
    const active = partnerActive(s);
    let partner = await this.prisma.partner.findUnique({ where: { userId } });
    if (!partner && active) partner = await this.issueCode(userId);
    if (!partner) return { active, shareBps: s.shareBps, termDays: s.termDays, code: null };

    const since = new Date(Date.now() - 30 * DAY);
    const [clicks, clicks30, registrations, sums, recent] = await Promise.all([
      this.prisma.partnerClickDay.aggregate({ where: { partnerId: userId }, _sum: { clicks: true } }),
      this.prisma.partnerClickDay.aggregate({ where: { partnerId: userId, day: { gte: since } }, _sum: { clicks: true } }),
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.partnerAccrual.aggregate({ where: { partnerId: userId }, _count: true, _sum: { amount: true } }),
      this.prisma.partnerAccrual.findMany({
        where: { partnerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { createdAt: true, role: true, amount: true, currency: true, order: { select: { publicNumber: true } } },
      }),
    ]);
    return {
      active,
      shareBps: s.shareBps,
      termDays: s.termDays,
      code: partner.code,
      stats: {
        clicks: clicks._sum.clicks ?? 0,
        clicks30: clicks30._sum.clicks ?? 0,
        registrations,
        deals: sums._count,
        accrued: (sums._sum.amount ?? 0n).toString(),
      },
      recent: recent.map((a) => ({
        at: a.createdAt,
        role: a.role,
        amount: a.amount.toString(),
        currency: a.currency,
        // Номер сделки — без суммы и ника: партнёру хватит факта.
        order: a.order.publicNumber,
      })),
    };
  }

  private async issueCode(userId: string) {
    for (let i = 0; i < 5; i++) {
      try {
        return await this.prisma.partner.create({ data: { userId, code: newPartnerCode() } });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        // Код занят — или второй запрос того же человека уже выдал свой.
        const own = await this.prisma.partner.findUnique({ where: { userId } });
        if (own) return own;
      }
    }
    throw new Error('Не удалось выдать код партнёра');
  }

  /** Переход по ссылке — в счётчик дня. Неизвестный код молча не считается. */
  async click(raw: string): Promise<{ ok: true }> {
    const code = normalizePartnerCode(raw);
    if (!code || !partnerActive(await this.settings())) return { ok: true };
    const partner = await this.prisma.partner.findUnique({ where: { code }, select: { userId: true } });
    if (!partner) return { ok: true };
    const day = new Date(new Date().toISOString().slice(0, 10));
    await this.prisma.partnerClickDay.upsert({
      where: { partnerId_day: { partnerId: partner.userId, day } },
      update: { clicks: { increment: 1 } },
      create: { partnerId: partner.userId, day, clicks: 1 },
    });
    return { ok: true };
  }

  /**
   * Привязка к партнёру — один раз, в первые сутки после регистрации, пока
   * сделок нет. Себя не привести: свой код, тот же IP или устройство, что в
   * сеансах партнёра за 30 дней, — не привязывается.
   */
  async attach(userId: string, raw: string, ctx: { ip?: string | null }): Promise<AttachResult> {
    const code = normalizePartnerCode(raw);
    if (!code) return { attached: false, reason: 'code' };
    if (!partnerActive(await this.settings())) return { attached: false, reason: 'off' };
    const [partner, user] = await Promise.all([
      this.prisma.partner.findUnique({ where: { code }, select: { userId: true, user: { select: { status: true } } } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { createdAt: true, referredById: true, sessions: { select: { ip: true, fingerprint: true } } },
      }),
    ]);
    if (!partner || partner.user.status !== 'active') return { attached: false, reason: 'code' };
    if (!user) return { attached: false, reason: 'user' };
    if (partner.userId === userId) return { attached: false, reason: 'self' };
    if (user.referredById) return { attached: false, reason: 'already' };
    if (Date.now() - user.createdAt.getTime() > PARTNER_ATTACH_HOURS * 3600_000) {
      return { attached: false, reason: 'late' };
    }
    const deals = await this.prisma.order.count({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }], status: { not: 'cancelled' } },
    });
    if (deals) return { attached: false, reason: 'late' };

    const ips = [...new Set([ctx.ip, ...user.sessions.map((s) => s.ip)].filter((v): v is string => !!v))];
    const prints = [...new Set(user.sessions.map((s) => s.fingerprint).filter((v): v is string => !!v))];
    const same = await this.prisma.authSession.count({
      where: {
        userId: partner.userId,
        createdAt: { gte: new Date(Date.now() - SAME_PERSON_DAYS * DAY) },
        OR: [...(ips.length ? [{ ip: { in: ips } }] : []), ...(prints.length ? [{ fingerprint: { in: prints } }] : [])],
      },
    });
    if ((ips.length || prints.length) && same) return { attached: false, reason: 'self' };

    // Условие в самом обновлении: два запроса подряд не привяжут дважды.
    const r = await this.prisma.user.updateMany({
      where: { id: userId, referredById: null },
      data: { referredById: partner.userId, referredAt: new Date() },
    });
    return r.count ? { attached: true } : { attached: false, reason: 'already' };
  }

  // ── Начисление ──

  /**
   * С завершённой сделки привлечённого — доля партнёру. Привлечён продавец —
   * партнёр продавца, иначе — партнёр покупателя: одна сделка — одно
   * начисление. Сделка с самим партнёром и вне срока — не в счёт.
   * Идемпотентно: одна запись и одна проводка на сделку.
   */
  async accrue(order: Pick<Order, 'id' | 'buyerId' | 'sellerId' | 'amount' | 'sellerPayoutAmount' | 'currency' | 'paymentMethod'> & { completedAt?: Date | null }) {
    const s = await this.settings();
    if (!partnerActive(s)) return null;
    const people = await this.prisma.user.findMany({
      where: { id: { in: [order.sellerId, order.buyerId] } },
      select: { id: true, referredById: true, referredAt: true },
    });
    const seller = people.find((p) => p.id === order.sellerId);
    const buyer = people.find((p) => p.id === order.buyerId);
    const at = order.completedAt ?? new Date();
    const pick = [
      { who: seller, role: 'seller' as const },
      { who: buyer, role: 'buyer' as const },
    ].find(
      ({ who }) =>
        who?.referredById &&
        who.referredAt &&
        who.referredById !== order.buyerId &&
        who.referredById !== order.sellerId &&
        withinPartnerTerm(who.referredAt, at, s.termDays),
    );
    if (!pick?.who?.referredById) return null;

    const { net } = dealEconomics({
      amountToPay: order.amount,
      sellerPayout: order.sellerPayoutAmount,
      paymentMethod: order.paymentMethod ?? 'balance',
    });
    const amount = partnerShare(net, s.shareBps);
    if (amount <= 0n) return null;
    const partnerId = pick.who.referredById;
    try {
      await this.prisma.partnerAccrual.create({
        data: {
          partnerId,
          orderId: order.id,
          referredId: pick.who.id,
          role: pick.role,
          net,
          shareBps: s.shareBps,
          amount,
          currency: order.currency,
        },
      });
    } catch (e) {
      // Уже начислено — второй проход ничего не делает.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
    // Из дохода площадки на баланс — как кэшбэк; вывод — обычный.
    await this.ledger.post({
      legs: partnerRewardToBalance(partnerId, amount),
      currency: order.currency,
      idempotencyKey: `partner:${order.id}`,
      refType: 'partner_reward',
      refId: order.id,
    });
    await this.notifications
      .notify(partnerId, 'partner_reward', { amount: amount.toString() })
      .catch((e) => this.logger.warn(`Уведомление партнёру: ${(e as Error).message}`));
    return { partnerId, amount };
  }
}
