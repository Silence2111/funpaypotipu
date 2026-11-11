import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaClient, type ModerationAction } from '@gamemarket/db';
import {
  APPEALABLE,
  APPEAL_REVIEW_HOURS,
  APPEAL_WINDOW_DAYS,
  PAYOUT_REVIEW_HOURS,
  holdFunds,
  releaseHeldFunds,
  ruleText,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../access/audit.service';
import { ModerationService } from '../moderation/moderation.service';
import { GameChatService } from '../game-chat/game-chat.service';

const SWEEP_MS = Number(process.env.APPEALS_SWEEP_MS ?? 10 * 60_000);
const STAFF_ROLES = ['admin', 'finance'];

/** Ключ решения для APPEALABLE: «user:block», «listing:block»… */
const kindOf = (a: Pick<ModerationAction, 'targetType' | 'action'>) => `${a.targetType}:${a.action}`;

/**
 * Блокировки без «чёрного ящика» (часть 134):
 * - решения о человеке — с причиной и пунктом правил, в кабинете
 *   «Решения модерации»; каждое обжалуется один раз в течение 30 дней;
 * - обжалование решает другой сотрудник, не тот, кто блокировал; отмена
 *   возвращает как было; не ответили за 48 ч — администратору;
 * - вместо заморозки всего — удержание только спорной суммы, остальное
 *   выводится;
 * - заявка на вывод проверяется в срок: затянулась — финансы и
 *   администратор получают уведомление, человек — что заявку подняли.
 */
@Injectable()
export class AppealsService {
  private readonly logger = new Logger(AppealsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly moderation: ModerationService,
    private readonly gameChat: GameChatService,
  ) {}

  // ─────────── Человек ───────────

  /** Решения модерации о человеке, его лотах и сообщениях — с обжалованием. */
  async mine(userId: string) {
    const [listings, messages] = await Promise.all([
      this.prisma.listing.findMany({ where: { sellerId: userId }, select: { id: true, title: true } }),
      this.prisma.gameChatMessage.findMany({ where: { userId, deletedAt: { not: null } }, select: { id: true, body: true } }),
    ]);
    const titles = new Map(listings.map((l) => [l.id, l.title]));
    const bodies = new Map(messages.map((m) => [m.id, m.body]));
    const since = new Date(Date.now() - 365 * 86_400_000);
    const rows = await this.prisma.moderationAction.findMany({
      where: {
        createdAt: { gte: since },
        OR: [
          { targetType: 'user', targetId: userId, action: { in: ['block', 'mute', 'hold'] } },
          ...(listings.length ? [{ targetType: 'listing', targetId: { in: listings.map((l) => l.id) }, action: 'block' as const }] : []),
          ...(messages.length ? [{ targetType: 'game_chat', targetId: { in: messages.map((m) => m.id) }, action: 'delete' as const }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { appeal: true },
    });
    const now = Date.now();
    return rows.map((a) => ({
      id: a.id,
      kind: APPEALABLE[kindOf(a)] ?? kindOf(a),
      reason: a.reason,
      rule: a.rule,
      ruleText: ruleText(a.rule),
      createdAt: a.createdAt,
      subject: a.targetType === 'listing' ? titles.get(a.targetId) ?? null : a.targetType === 'game_chat' ? bodies.get(a.targetId) ?? null : null,
      appeal: a.appeal
        ? { status: a.appeal.status, text: a.appeal.text, note: a.appeal.note, createdAt: a.appeal.createdAt, decidedAt: a.appeal.decidedAt, dueAt: a.appeal.dueAt }
        : null,
      canAppeal: !a.appeal && now - a.createdAt.getTime() < APPEAL_WINDOW_DAYS * 86_400_000,
    }));
  }

  async appeal(userId: string, actionId: string, text: string) {
    const action = await this.prisma.moderationAction.findUnique({ where: { id: actionId }, include: { appeal: true } });
    if (!action || !(await this.concerns(action, userId))) throw new NotFoundException('Решение не найдено');
    if (!APPEALABLE[kindOf(action)]) throw new BadRequestException('Это решение не обжалуется');
    if (action.appeal) throw new ConflictException('Это решение уже обжаловано — второй раз нельзя');
    if (Date.now() - action.createdAt.getTime() > APPEAL_WINDOW_DAYS * 86_400_000) {
      throw new BadRequestException(`Обжаловать можно в течение ${APPEAL_WINDOW_DAYS} дней после решения`);
    }
    const appeal = await this.prisma.appeal.create({
      data: { actionId, userId, text, dueAt: new Date(Date.now() + APPEAL_REVIEW_HOURS * 3_600_000) },
    });
    await this.audit.log({ actorId: userId, action: 'appeal.create', entityType: 'appeal', entityId: appeal.id, after: { actionId } });
    return appeal;
  }

  /** Решение касается человека: о нём, о его лоте или его сообщении. */
  private async concerns(a: ModerationAction, userId: string): Promise<boolean> {
    if (a.targetType === 'user') return a.targetId === userId;
    if (a.targetType === 'listing') {
      const l = await this.prisma.listing.findUnique({ where: { id: a.targetId }, select: { sellerId: true } });
      return l?.sellerId === userId;
    }
    if (a.targetType === 'game_chat') {
      const m = await this.prisma.gameChatMessage.findUnique({ where: { id: a.targetId }, select: { userId: true } });
      return m?.userId === userId;
    }
    return false;
  }

  /** Удержания человека — для «Кошелька». */
  async holdsOf(userId: string) {
    const rows = await this.prisma.balanceHold.findMany({
      where: { userId, releasedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((h) => ({ id: h.id, amount: h.amount, currency: h.currency, reason: h.reason, rule: h.rule, ruleText: ruleText(h.rule), createdAt: h.createdAt }));
  }

  // ─────────── Сотрудник ───────────

  /** Очередь обжалований: открытые — сначала просроченные, потом старые. */
  async queue(status: 'open' | 'decided' = 'open') {
    const rows = await this.prisma.appeal.findMany({
      where: status === 'open' ? { status: 'open' } : { status: { not: 'open' } },
      orderBy: status === 'open' ? [{ escalatedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }] : [{ decidedAt: 'desc' }],
      take: 100,
      include: { action: true, user: { select: { id: true, status: true, profile: { select: { username: true } } } } },
    });
    const staff = [...new Set(rows.flatMap((r) => [r.action.actorId, r.decidedBy]).filter((x): x is string => !!x))];
    const names = new Map(
      (await this.prisma.profile.findMany({ where: { userId: { in: staff } }, select: { userId: true, username: true } })).map((p) => [p.userId, p.username]),
    );
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      text: r.text,
      note: r.note,
      createdAt: r.createdAt,
      dueAt: r.dueAt,
      escalatedAt: r.escalatedAt,
      decidedAt: r.decidedAt,
      decidedBy: r.decidedBy ? names.get(r.decidedBy) ?? null : null,
      user: { id: r.user.id, status: r.user.status, username: r.user.profile?.username ?? null },
      decision: {
        id: r.action.id,
        kind: APPEALABLE[kindOf(r.action)] ?? kindOf(r.action),
        targetType: r.action.targetType,
        targetId: r.action.targetId,
        reason: r.action.reason,
        rule: r.action.rule,
        ruleText: ruleText(r.action.rule),
        at: r.action.createdAt,
        by: r.action.actorId ? names.get(r.action.actorId) ?? null : null,
        byId: r.action.actorId,
      },
    }));
  }

  /**
   * Решение по обжалованию — другим сотрудником. «Отменить» возвращает как
   * было: снимает заморозку, блокировку лота, запрет писать, удержание,
   * возвращает сообщение в чат.
   */
  async decide(staffId: string, appealId: string, outcome: 'upheld' | 'overturned', note: string) {
    const appeal = await this.prisma.appeal.findUnique({ where: { id: appealId }, include: { action: true } });
    if (!appeal) throw new NotFoundException('Обжалование не найдено');
    if (appeal.status !== 'open') throw new ConflictException('Обжалование уже решено');
    if (appeal.action.actorId === staffId) {
      throw new ForbiddenException('Обжалование решает другой сотрудник — не тот, кто принял решение');
    }
    if (outcome === 'overturned') await this.reverse(staffId, appeal.action, note);
    const done = await this.prisma.appeal.update({
      where: { id: appealId },
      data: { status: outcome, decidedBy: staffId, decidedAt: new Date(), note },
    });
    await this.audit.log({
      actorId: staffId,
      action: `appeal.${outcome}`,
      entityType: 'appeal',
      entityId: appealId,
      before: { decision: appeal.action.id, by: appeal.action.actorId },
      after: { note },
    });
    await this.notifications.notify(appeal.userId, 'appeal_decided', { outcome, note, appealId });
    return done;
  }

  private async reverse(staffId: string, a: ModerationAction, note: string) {
    const reason = `Отменено по обжалованию: ${note}`;
    switch (kindOf(a)) {
      case 'user:block': {
        const u = await this.prisma.user.findUnique({ where: { id: a.targetId }, select: { status: true } });
        if (u?.status === 'frozen') await this.moderation.setUserStatus(staffId, a.targetId, 'active', reason);
        return;
      }
      case 'listing:block': {
        const l = await this.prisma.listing.findUnique({ where: { id: a.targetId }, select: { status: true } });
        if (l?.status === 'blocked') await this.moderation.setListingStatus(staffId, a.targetId, 'active', reason);
        return;
      }
      case 'user:mute':
        await this.gameChat.mute(staffId, a.targetId, 0, reason);
        return;
      case 'game_chat:delete':
        await this.prisma.gameChatMessage.update({
          where: { id: a.targetId },
          data: { deletedAt: null, deletedBy: null, deleteReason: null },
        });
        return;
      case 'user:hold': {
        const hold = await this.prisma.balanceHold.findFirst({
          where: { userId: a.targetId, releasedAt: null, createdAt: { gte: new Date(a.createdAt.getTime() - 5_000), lte: new Date(a.createdAt.getTime() + 5_000) } },
        });
        if (hold) await this.release(staffId, hold.id, reason);
        return;
      }
      default:
        throw new BadRequestException('Это решение не отменяется обжалованием');
    }
  }

  /**
   * Удержать сумму (часть 134): с доступного на «удержано» того же человека,
   * с причиной и пунктом правил. Аккаунт работает, остальное выводится.
   */
  async hold(staffId: string, userId: string, amount: bigint, reason: string, rule: string | undefined, currency = 'RUB') {
    if (userId === staffId) throw new BadRequestException('Свой баланс так не удерживают');
    if (amount <= 0n) throw new BadRequestException('Сумма должна быть положительной');
    const balance = await this.ledger.balanceOf(userId, currency);
    if (balance < amount) {
      throw new BadRequestException(`На балансе ${new Intl.NumberFormat('ru-RU').format(Number(balance) / 100)} ₽ — удержать больше нельзя`);
    }
    const hold = await this.prisma.$transaction(async (tx) => {
      const h = await tx.balanceHold.create({ data: { userId, amount, currency, reason, rule, createdBy: staffId } });
      await this.ledger.post(
        { legs: holdFunds(userId, amount), currency, idempotencyKey: `hold:${h.id}`, refType: 'balance_hold', refId: h.id },
        tx,
      );
      await this.ledger.assertNotOverdrawn(tx, userId, currency);
      return h;
    });
    const decision = await this.prisma.moderationAction.create({
      data: { actorId: staffId, targetType: 'user', targetId: userId, action: 'hold', reason, rule },
    });
    await this.audit.log({
      actorId: staffId,
      action: 'balance.hold',
      entityType: 'user',
      entityId: userId,
      after: { holdId: hold.id, amount: amount.toString(), reason, rule: rule ?? null },
    });
    await this.notifications.notify(userId, 'balance_held', {
      amount: amount.toString(),
      reason,
      ...(rule ? { rule } : {}),
      decisionId: decision.id,
    });
    return { ...hold, amount: hold.amount.toString() };
  }

  async release(staffId: string, holdId: string, note: string) {
    const hold = await this.prisma.balanceHold.findUnique({ where: { id: holdId } });
    if (!hold) throw new NotFoundException('Удержание не найдено');
    if (hold.releasedAt) return { ...hold, amount: hold.amount.toString() };
    const done = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.balanceHold.updateMany({
        where: { id: holdId, releasedAt: null },
        data: { releasedAt: new Date(), releasedBy: staffId, releaseNote: note },
      });
      if (claimed.count === 0) return false;
      await this.ledger.post(
        { legs: releaseHeldFunds(hold.userId, hold.amount), currency: hold.currency, idempotencyKey: `hold_release:${hold.id}`, refType: 'balance_hold_release', refId: hold.id },
        tx,
      );
      return true;
    });
    if (done) {
      await this.audit.log({ actorId: staffId, action: 'balance.release', entityType: 'user', entityId: hold.userId, after: { holdId, note } });
      await this.notifications.notify(hold.userId, 'balance_released', { amount: hold.amount.toString(), note });
    }
    const fresh = await this.prisma.balanceHold.findUnique({ where: { id: holdId } });
    return { ...fresh!, amount: fresh!.amount.toString() };
  }

  /** Активные удержания для консоли. */
  async activeHolds() {
    const rows = await this.prisma.balanceHold.findMany({
      where: { releasedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, profile: { select: { username: true } } } } },
    });
    return rows.map((h) => ({ ...h, amount: h.amount.toString(), ruleText: ruleText(h.rule), username: h.user.profile?.username ?? null }));
  }

  // ─────────── Сроки ───────────

  /**
   * Сроки (часть 134): обжалование без ответа дольше 48 ч и заявка на вывод
   * без решения дольше 24 ч после холда — администратору и финансам
   * уведомление, отметка «передано старшему»; человеку по выводу — что
   * заявку подняли.
   */
  @Interval('appeals-escalation', SWEEP_MS)
  async escalate() {
    const now = new Date();
    const appeals = await this.prisma.appeal.findMany({
      where: { status: 'open', escalatedAt: null, dueAt: { lte: now } },
      select: { id: true },
      take: 100,
    });
    const payouts = await this.prisma.payout.findMany({
      where: { status: 'requested', escalatedAt: null },
      select: { id: true, userId: true, createdAt: true, holdUntil: true },
      take: 500,
    });
    const late = payouts.filter((p) => reviewBy(p).getTime() <= now.getTime());
    if (!appeals.length && !late.length) return;
    const staff = await this.prisma.user.findMany({
      where: { status: 'active', roles: { some: { role: { key: { in: STAFF_ROLES } } } } },
      select: { id: true },
    });
    for (const a of appeals) {
      const claimed = await this.prisma.appeal.updateMany({ where: { id: a.id, escalatedAt: null }, data: { escalatedAt: now } });
      if (!claimed.count) continue;
      for (const s of staff) await this.notifications.notify(s.id, 'appeal_overdue', { appealId: a.id }).catch(() => null);
    }
    for (const p of late) {
      const claimed = await this.prisma.payout.updateMany({ where: { id: p.id, escalatedAt: null, status: 'requested' }, data: { escalatedAt: now } });
      if (!claimed.count) continue;
      for (const s of staff) await this.notifications.notify(s.id, 'payout_overdue', { payoutId: p.id }).catch(() => null);
      await this.notifications.notify(p.userId, 'payout_delayed', { payoutId: p.id }).catch(() => null);
    }
    if (appeals.length || late.length) this.logger.log(`Эскалация: обжалований ${appeals.length}, выводов ${late.length}`);
  }
}

/** До какого времени проверим заявку на вывод: после холда новичка плюс срок. */
export function reviewBy(p: { createdAt: Date; holdUntil: Date | null }): Date {
  const start = p.holdUntil && p.holdUntil > p.createdAt ? p.holdUntil : p.createdAt;
  return new Date(start.getTime() + PAYOUT_REVIEW_HOURS * 3_600_000);
}
