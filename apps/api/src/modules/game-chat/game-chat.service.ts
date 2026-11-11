import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import {
  GAME_CHAT_COOLDOWN_SEC,
  GAME_CHAT_NEWBIE_COOLDOWN_SEC,
  GAME_CHAT_NEWBIE_PER_DAY,
  GAME_CHAT_PAGE,
  GAME_CHAT_REPEAT_MIN,
  chatFingerprint,
  isNewbie,
  isShouting,
  maskContacts,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { AccountStatusService } from '../access/account-status.service';
import { AuditService } from '../access/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const author = {
  select: {
    id: true,
    profile: { select: { username: true, avatarUrl: true, ratingAvg: true, ratingCount: true, salesCount: true } },
  },
} as const;

const chatError = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  new HttpException({ statusCode: status, error, message, ...extra }, status);

/**
 * Общий чат игры (часть 133): читать может каждый, писать — вошедший, не
 * замороженный и без запрета писать. Контакты и ссылки скрываются (как в
 * чате сделки, с сигналом риска), пауза между сообщениями, у новичка —
 * реже и не больше 20 в сутки, повтор того же текста и крик заглавными —
 * отказ. Удаление и запрет писать — сотрудником, с причиной и в журнал.
 */
@Injectable()
export class GameChatService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly account: AccountStatusService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async gameOf(slug: string) {
    const game = await this.prisma.game.findUnique({ where: { slug }, select: { id: true, isActive: true, title: true } });
    if (!game || !game.isActive) throw new NotFoundException('Игра не найдена');
    return game;
  }

  /** Последние сообщения: новые снизу; `before` — id самого старого показанного. */
  async list(slug: string, before?: string) {
    const game = await this.gameOf(slug);
    const anchor = before
      ? await this.prisma.gameChatMessage.findUnique({ where: { id: before }, select: { createdAt: true, gameId: true } })
      : null;
    const rows = await this.prisma.gameChatMessage.findMany({
      where: {
        gameId: game.id,
        deletedAt: null,
        ...(anchor && anchor.gameId === game.id ? { createdAt: { lt: anchor.createdAt } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: GAME_CHAT_PAGE + 1,
      select: { id: true, body: true, createdAt: true, user: author },
    });
    const page = rows.slice(0, GAME_CHAT_PAGE).reverse();
    return {
      items: page.map((m) => this.view(m)),
      more: rows.length > GAME_CHAT_PAGE,
    };
  }

  private view(m: { id: string; body: string; createdAt: Date; user: { id: string; profile: { username: string; avatarUrl: string | null; ratingAvg: number; ratingCount: number; salesCount: number } | null } }) {
    return {
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      user: {
        id: m.user.id,
        username: m.user.profile?.username ?? null,
        avatarUrl: m.user.profile?.avatarUrl ?? null,
        ratingAvg: m.user.profile?.ratingAvg ?? 0,
        ratingCount: m.user.profile?.ratingCount ?? 0,
        salesCount: m.user.profile?.salesCount ?? 0,
      },
    };
  }

  async post(slug: string, userId: string, raw: string) {
    const game = await this.gameOf(slug);
    await this.account.assertCanTrade(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true, profile: { select: { chatMutedUntil: true, chatMuteReason: true } } },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const muted = user.profile?.chatMutedUntil;
    if (muted && muted > new Date()) {
      throw chatError(403, 'chat_muted', 'Модератор запретил вам писать в чат игр. Причина и срок — ниже.', {
        until: muted,
        reason: user.profile?.chatMuteReason ?? null,
      });
    }
    const text = raw.trim().replace(/\s{3,}/g, '  ');
    if (isShouting(text)) throw new BadRequestException('Не пишите заглавными — так сообщение похоже на спам');

    const deals = await this.prisma.order.count({
      where: { status: 'completed', OR: [{ buyerId: userId }, { sellerId: userId }] },
      take: 1,
    });
    const newbie = isNewbie(user.createdAt, deals);
    const last = await this.prisma.gameChatMessage.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const pause = newbie ? GAME_CHAT_NEWBIE_COOLDOWN_SEC : GAME_CHAT_COOLDOWN_SEC;
    const wait = last ? Math.ceil(pause - (Date.now() - last.createdAt.getTime()) / 1000) : 0;
    if (wait > 0) {
      throw chatError(429, 'chat_cooldown', `Следующее сообщение — через ${wait} с.`, { retryAfter: wait });
    }
    if (newbie) {
      const today = await this.prisma.gameChatMessage.count({
        where: { userId, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
      });
      if (today >= GAME_CHAT_NEWBIE_PER_DAY) {
        throw chatError(
          429,
          'chat_newbie_limit',
          `Новым аккаунтам — до ${GAME_CHAT_NEWBIE_PER_DAY} сообщений в чатах игр за сутки. Ограничение снимется после первой сделки или через 3 дня.`,
        );
      }
    }
    const fingerprint = chatFingerprint(text);
    if (!fingerprint) throw new BadRequestException('Напишите сообщение словами');
    const repeat = await this.prisma.gameChatMessage.count({
      where: { userId, fingerprint, createdAt: { gte: new Date(Date.now() - GAME_CHAT_REPEAT_MIN * 60_000) } },
      take: 1,
    });
    if (repeat) {
      throw chatError(429, 'chat_repeat', `Это сообщение уже было — повторить можно через ${GAME_CHAT_REPEAT_MIN} минут.`);
    }

    const { masked, flagged } = maskContacts(text);
    const message = await this.prisma.gameChatMessage.create({
      data: { gameId: game.id, userId, body: masked, fingerprint },
      select: { id: true, body: true, createdAt: true, user: author },
    });
    // Контакты в общем чате — тот же сигнал антифрода, что в чате сделки.
    if (flagged) {
      await this.prisma.riskSignal.create({
        data: { userId, type: 'contact_leak', score: 10, payload: { gameChat: message.id } },
      });
    }
    return { ...this.view(message), masked: flagged };
  }

  /** Своё сообщение автор убирает сам — без следа на сайте. */
  async removeOwn(userId: string, id: string) {
    const m = await this.prisma.gameChatMessage.findUnique({ where: { id }, select: { userId: true, deletedAt: true } });
    if (!m || m.deletedAt) throw new NotFoundException('Сообщение не найдено');
    if (m.userId !== userId) throw new ForbiddenException('Это не ваше сообщение');
    await this.prisma.gameChatMessage.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: userId, deleteReason: 'Удалил автор' },
    });
    return { ok: true };
  }

  // ─────────── Консоль ───────────

  /**
   * Сообщения всех игр для сотрудника: новые сверху; с жалобами — фильтром;
   * удалённые — с причиной. Поиск по тексту и нику.
   */
  async moderationList(q: { game?: string; reported?: boolean; q?: string; before?: string; deleted?: boolean }) {
    const anchor = q.before
      ? await this.prisma.gameChatMessage.findUnique({ where: { id: q.before }, select: { createdAt: true } })
      : null;
    const reportedIds = q.reported
      ? (
          await this.prisma.report.findMany({
            where: { targetType: 'game_chat', status: { in: ['open', 'reviewing'] } },
            select: { targetId: true },
            take: 500,
          })
        ).map((r) => r.targetId)
      : null;
    const text = q.q?.trim();
    const rows = await this.prisma.gameChatMessage.findMany({
      where: {
        ...(q.game ? { game: { slug: q.game } } : {}),
        ...(q.deleted ? { deletedAt: { not: null } } : {}),
        ...(reportedIds ? { id: { in: reportedIds } } : {}),
        ...(anchor ? { createdAt: { lt: anchor.createdAt } } : {}),
        ...(text
          ? {
              OR: [
                { body: { contains: text, mode: 'insensitive' as const } },
                { user: { profile: { username: { contains: text, mode: 'insensitive' as const } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      select: {
        id: true,
        body: true,
        createdAt: true,
        deletedAt: true,
        deleteReason: true,
        game: { select: { slug: true, title: true } },
        user: { select: { id: true, status: true, profile: { select: { username: true, chatMutedUntil: true } } } },
      },
    });
    const page = rows.slice(0, 50);
    const reports = page.length
      ? await this.prisma.report.groupBy({
          by: ['targetId'],
          where: { targetType: 'game_chat', targetId: { in: page.map((m) => m.id) }, status: { in: ['open', 'reviewing'] } },
          _count: { _all: true },
        })
      : [];
    const open = new Map(reports.map((r) => [r.targetId, r._count._all]));
    return {
      items: page.map((m) => ({ ...m, openReports: open.get(m.id) ?? 0 })),
      next: rows.length > 50 ? page[page.length - 1]!.id : null,
    };
  }

  async remove(staffId: string, id: string, reason: string) {
    const m = await this.prisma.gameChatMessage.findUnique({ where: { id }, select: { id: true, userId: true, body: true, deletedAt: true } });
    if (!m) throw new NotFoundException('Сообщение не найдено');
    if (!m.deletedAt) {
      await this.prisma.gameChatMessage.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: staffId, deleteReason: reason },
      });
    }
    // Жалобы на него решены: сообщения больше нет.
    await this.prisma.report.updateMany({
      where: { targetType: 'game_chat', targetId: id, status: { in: ['open', 'reviewing'] } },
      data: { status: 'resolved', handledBy: staffId, handledAt: new Date() },
    });
    await this.audit.log({
      actorId: staffId,
      action: 'game_chat.delete',
      entityType: 'game_chat',
      entityId: id,
      before: { body: m.body, userId: m.userId },
      after: { reason },
    });
    return { ok: true };
  }

  /** Запрет писать в чаты игр на срок; 0 часов — снять запрет. */
  async mute(staffId: string, userId: string, hours: number, reason: string) {
    const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { chatMutedUntil: true } });
    if (!profile) throw new NotFoundException('Пользователь не найден');
    const until = hours > 0 ? new Date(Date.now() + hours * 3_600_000) : null;
    await this.prisma.profile.update({
      where: { userId },
      data: { chatMutedUntil: until, chatMuteReason: until ? reason : null },
    });
    await this.audit.log({
      actorId: staffId,
      action: until ? 'game_chat.mute' : 'game_chat.unmute',
      entityType: 'user',
      entityId: userId,
      before: { until: profile.chatMutedUntil },
      after: { until, reason },
    });
    if (until) await this.notifications.notify(userId, 'chat_muted', { until: until.toISOString(), reason });
    return { userId, chatMutedUntil: until };
  }
}
