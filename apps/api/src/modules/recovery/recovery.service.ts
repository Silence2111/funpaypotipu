import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { deviceOf } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../access/audit.service';
import { TokenService } from '../auth/token.service';
import { NOT_ME_RESET_TTL, passwordStamp, type RequestCtx } from '../auth/auth.service';
import { langOf, say } from '../../i18n/texts';

/**
 * Решение по заявке — не раньше чем через 3 дня. Если заявку подал не
 * владелец, а владелец ещё в аккаунте, он успеет отметить «Заявку подал не я».
 */
export const RECOVERY_WAIT_MS = 72 * 3_600_000;
export const RECOVERY_REASONS = ['two_factor', 'password', 'other'] as const;
export type RecoveryReason = (typeof RECOVERY_REASONS)[number];
export type RecoveryStatus = 'pending' | 'restored' | 'rejected';

/** Номер заказа — без учёта регистра: в номере есть строчные буквы, а вводят как угодно. */
const byNumber = (numbers: string[]) =>
  numbers.map((n) => ({ publicNumber: { equals: n, mode: 'insensitive' as const } }));

const SECURITY_TYPES = [
  'new_login',
  'password_changed',
  'two_factor_enabled',
  'two_factor_disabled',
  'recovery_requested',
];

/**
 * «Не могу войти»: восстановление доступа через сотрудника, когда «Это не я»
 * из писем не помогло — например, чужой сменил пароль, а потом включил вход
 * с кодом. Такой путь — излюбленный у мошенников, поэтому:
 * - ответ на заявку всегда один: по нему не узнать, есть ли аккаунт;
 * - владельцу аккаунта приходит уведомление, и он может отметить «Заявку
 *   подал не я» — это не отмена (в аккаунте может сидеть и чужой), а знак
 *   сотруднику;
 * - решить можно не раньше чем через 3 дня;
 * - сотрудник видит, какие номера заказов из заявки у этого аккаунта, и
 *   историю входов, смен пароля и входа с кодом;
 * - восстановление сбрасывает всё, чем мог завладеть чужой, а ссылка задать
 *   пароль уходит только на почту аккаунта.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /** Заявка без входа. Ответ всегда один — есть аккаунт или нет. */
  async request(
    input: { email: string; reason: RecoveryReason; orderNumbers: string[]; details: string },
    ctx: RequestCtx,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: input.email.trim(), mode: 'insensitive' } },
      select: { id: true },
    });
    if (!user) return { ok: true };
    // Одна заявка в ожидании: повтор не плодит очередь и уведомления.
    const pending = await this.prisma.accountRecovery.findFirst({
      where: { userId: user.id, status: 'pending' },
      select: { id: true },
    });
    if (pending) return { ok: true };
    // Без пробелов и повторов; регистр — как ввели: заказы сверяются без учёта регистра.
    const orderNumbers = input.orderNumbers
      .map((n) => n.trim())
      .filter((n, k, all) => n && all.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === k);
    const rec = await this.prisma.accountRecovery.create({
      data: {
        userId: user.id,
        reason: input.reason,
        orderNumbers,
        details: input.details.trim(),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
    this.alert(user.id, 'recovery_requested', { recoveryId: rec.id }, (lang) =>
      say(
        lang,
        'Подана заявка на восстановление доступа к аккаунту: {device}. Если это не вы — отметьте «Заявку подал не я» в «Безопасности».',
        { device: deviceOf(ctx.userAgent, lang) },
      ),
    );
    return { ok: true };
  }

  /** Заявка в ожидании на своём аккаунте — для «Безопасности». IP заявителя не показывается. */
  async mine(userId: string) {
    const rec = await this.prisma.accountRecovery.findFirst({
      where: { userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (!rec) return { request: null };
    return {
      request: {
        id: rec.id,
        createdAt: rec.createdAt,
        userAgent: rec.userAgent,
        objected: rec.objectedAt !== null,
        decideAfter: new Date(rec.createdAt.getTime() + RECOVERY_WAIT_MS),
      },
    };
  }

  /** «Заявку подал не я» — из аккаунта; сотрудник увидит, когда и с какого устройства. */
  async object(userId: string, id: string, ctx: RequestCtx) {
    const res = await this.prisma.accountRecovery.updateMany({
      where: { id, userId, status: 'pending', objectedAt: null },
      data: {
        objectedAt: new Date(),
        objectedFrom: `${deviceOf(ctx.userAgent)}${ctx.ip ? ` · IP ${ctx.ip}` : ''}`,
      },
    });
    if (!res.count) {
      const exists = await this.prisma.accountRecovery.count({
        where: { id, userId, status: 'pending' },
      });
      if (!exists) throw new NotFoundException('Заявка не найдена');
    }
    return { ok: true };
  }

  /** Очередь сотрудника: ждущие решения — старые сверху. */
  async queue(status: RecoveryStatus) {
    const rows = await this.prisma.accountRecovery.findMany({
      where: { status },
      orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
      take: 100,
      include: { user: { select: { email: true, profile: { select: { username: true } } } } },
    });
    const matched = await this.matches(
      rows.map((r) => ({ userId: r.userId, numbers: r.orderNumbers })),
    );
    return rows.map((r, i) => ({
      id: r.id,
      createdAt: r.createdAt,
      status: r.status,
      reason: r.reason,
      email: r.user.email,
      username: r.user.profile?.username ?? null,
      orders: { given: r.orderNumbers.length, found: matched[i] },
      objected: r.objectedAt !== null,
      decideAfter: new Date(r.createdAt.getTime() + RECOVERY_WAIT_MS),
    }));
  }

  /** Заявка целиком: что совпало с аккаунтом и что с ним происходило. */
  async detail(id: string) {
    const rec = await this.prisma.accountRecovery.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            email: true,
            emailVerified: true,
            createdAt: true,
            passwordHash: true,
            telegramId: true,
            profile: { select: { username: true } },
            twoFactor: { select: { enabledAt: true } },
            socialAccounts: { select: { provider: true, createdAt: true } },
          },
        },
      },
    });
    if (!rec) throw new NotFoundException('Заявка не найдена');
    const [orders, history] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          AND: [
            { OR: byNumber(rec.orderNumbers) },
            { OR: [{ buyerId: rec.userId }, { sellerId: rec.userId }] },
          ],
        },
        select: { publicNumber: true, buyerId: true, status: true, amount: true, createdAt: true },
      }),
      this.prisma.notification.findMany({
        where: { userId: rec.userId, type: { in: SECURITY_TYPES } },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { type: true, payload: true, createdAt: true },
      }),
    ]);
    const u = rec.user;
    return {
      id: rec.id,
      status: rec.status,
      reason: rec.reason,
      details: rec.details,
      createdAt: rec.createdAt,
      decideAfter: new Date(rec.createdAt.getTime() + RECOVERY_WAIT_MS),
      requester: { device: deviceOf(rec.userAgent), ip: rec.ip },
      objected: rec.objectedAt ? { at: rec.objectedAt, from: rec.objectedFrom } : null,
      decidedAt: rec.decidedAt,
      note: rec.note,
      account: {
        username: u.profile?.username ?? null,
        email: u.email,
        emailVerified: u.emailVerified !== null,
        createdAt: u.createdAt,
        hasPassword: u.passwordHash !== null,
        twoFactorSince: u.twoFactor?.enabledAt ?? null,
        telegram: u.telegramId !== null,
        social: u.socialAccounts,
      },
      orders: rec.orderNumbers.map((n) => {
        const o = orders.find((x) => x.publicNumber.toLowerCase() === n.toLowerCase());
        return o
          ? {
              number: o.publicNumber,
              found: true,
              role: o.buyerId === rec.userId ? 'buyer' : 'seller',
              status: o.status,
              amount: o.amount.toString(),
              createdAt: o.createdAt,
            }
          : { number: n, found: false };
      }),
      history: history.map((h) => {
        const p = (h.payload ?? {}) as Record<string, unknown>;
        return {
          type: h.type,
          at: h.createdAt,
          device: typeof p.device === 'string' ? p.device : null,
          ip: typeof p.ip === 'string' ? p.ip : null,
        };
      }),
    };
  }

  /**
   * Восстановить доступ: выключить вход с кодом, отвязать вход через сервисы,
   * Telegram и пуши, вывести все устройства и сбросить пароль — войти не
   * сможет никто, пока владелец не задаст новый по ссылке из письма на почту
   * аккаунта (сутки, один раз).
   */
  async restore(id: string, staffId: string, ip?: string, now = new Date()) {
    const rec = await this.pendingOrThrow(id, now);
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.accountRecovery.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'restored', decidedById: staffId, decidedAt: now },
      });
      if (!done.count) throw new BadRequestException('По заявке уже решено');
      await tx.twoFactor.deleteMany({ where: { userId: rec.userId } });
      await tx.socialAccount.deleteMany({ where: { userId: rec.userId } });
      await tx.pushSubscription.deleteMany({ where: { userId: rec.userId } });
      await tx.authSession.deleteMany({ where: { userId: rec.userId } });
      await tx.user.update({
        where: { id: rec.userId },
        data: { passwordHash: null, telegramId: null },
      });
    });
    await this.audit.log({
      actorId: staffId,
      action: 'recovery.restore',
      entityType: 'user',
      entityId: rec.userId,
      after: { recoveryId: id },
      ip,
    });
    const token = this.tokens.signPurpose(
      rec.userId,
      'pwd_reset',
      NOT_ME_RESET_TTL,
      passwordStamp(null),
    );
    const web = process.env.WEB_URL ?? 'http://localhost:3000';
    this.alert(
      rec.userId,
      'recovery_restored',
      { recoveryId: id },
      (lang) =>
        say(
          lang,
          'Доступ к аккаунту восстановлен: вход с кодом выключен, вход через сервисы отвязан, все устройства вышли. Задайте новый пароль по ссылке из письма.',
        ),
      { action: 'Задать новый пароль', link: `${web}/reset?token=${encodeURIComponent(token)}` },
    );
    return { ok: true };
  }

  /** Отклонить с причиной — она придёт на почту аккаунта. */
  async reject(id: string, staffId: string, note: string, ip?: string) {
    const rec = await this.prisma.accountRecovery.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Заявка не найдена');
    const done = await this.prisma.accountRecovery.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', decidedById: staffId, decidedAt: new Date(), note },
    });
    if (!done.count) throw new BadRequestException('По заявке уже решено');
    await this.audit.log({
      actorId: staffId,
      action: 'recovery.reject',
      entityType: 'user',
      entityId: rec.userId,
      after: { recoveryId: id, note },
      ip,
    });
    this.alert(rec.userId, 'recovery_rejected', { recoveryId: id }, (lang) =>
      say(lang, 'Заявка на восстановление доступа отклонена: {note}', { note }),
    );
    return { ok: true };
  }

  private async pendingOrThrow(id: string, now: Date) {
    const rec = await this.prisma.accountRecovery.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Заявка не найдена');
    if (rec.status !== 'pending') throw new BadRequestException('По заявке уже решено');
    if (now.getTime() < rec.createdAt.getTime() + RECOVERY_WAIT_MS) {
      throw new BadRequestException(
        'Решить можно через 3 дня после заявки: владелец должен успеть её увидеть',
      );
    }
    return rec;
  }

  /** Сколько номеров заказов из каждой заявки — у этого аккаунта. */
  private async matches(items: Array<{ userId: string; numbers: string[] }>) {
    const all = items.flatMap((i) => i.numbers);
    if (!all.length) return items.map(() => 0);
    const orders = await this.prisma.order.findMany({
      where: { OR: byNumber(all) },
      select: { publicNumber: true, buyerId: true, sellerId: true },
    });
    return items.map(
      (i) =>
        orders.filter(
          (o) =>
            i.numbers.some((n) => n.toLowerCase() === o.publicNumber.toLowerCase()) &&
            (o.buyerId === i.userId || o.sellerId === i.userId),
        ).length,
    );
  }

  /** Уведомление владельцу аккаунта: письмом — всегда (группа «Безопасность»). */
  private alert(
    userId: string,
    type: 'recovery_requested' | 'recovery_restored' | 'recovery_rejected',
    data: Record<string, string>,
    preview: (lang: 'ru' | 'en') => string,
    mail?: { action: string; link: string },
  ) {
    const send = async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { locale: true },
      });
      const lang = langOf(user?.locale);
      await this.notifications.notify(
        userId,
        type,
        { ...data, preview: preview(lang) },
        mail ? { mail } : {},
      );
    };
    void send().catch((e: Error) => this.logger.warn(`Восстановление ${userId}: ${e.message}`));
  }
}
