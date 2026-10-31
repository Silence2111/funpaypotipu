import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  type ListingStatus,
  type Report,
  type ReportStatus,
  type UserStatus,
} from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { containsText } from '../../common/like';
import { nextCursor } from '../../common/cursor';
import { AuditService } from '../access/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export type ReportTarget = 'listing' | 'user' | 'message';
/** Что модератор делает с нарушителем, закрывая жалобу. */
export type ReportAction = 'block_listing' | 'freeze_user' | 'ban_user';

/** Роли сотрудников: их статус меняет только администратор. */
const STAFF_ROLES = ['agent', 'moderator', 'finance', 'admin'];
const OPEN: ReportStatus[] = ['open', 'reviewing'];

/** Страница очереди жалоб: какие, с какой карточки продолжать, сколько. */
export interface ReportsQuery {
  /** Без статуса — открытые (новые и взятые в работу). */
  status?: ReportStatus;
  /** Из `next` прошлой страницы: время (первой жалобы или решения) и цель последней карточки. */
  cursor?: { at: Date; id: string };
  limit?: number;
}

/** Карточка очереди из базы: цель, решение (у решённых) и её жалобы. */
type ReportGroup = {
  target_type: ReportTarget;
  target_id: string;
  handled_at: Date | null;
  n: number;
  first_at: Date;
  last_at: Date;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ModerationService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Жалобы (любой пользователь) ──

  /**
   * Жалоба на лот, пользователя или сообщение. Цель проверяется: раньше
   * принималась любая строка, и очередь модератора забивалась жалобами на
   * несуществующее. Повторная жалоба на то же самое не плодит строки.
   */
  async createReport(reporterId: string, targetType: ReportTarget, targetId: string, reason: string, details?: string) {
    await this.assertReportable(reporterId, targetType, targetId);
    const open = await this.prisma.report.findFirst({
      where: { reporterId, targetType, targetId, status: { in: OPEN } },
    });
    if (open) return open;
    return this.prisma.report.create({
      data: { reporterId, targetType, targetId, reason, details, status: 'open' },
    });
  }

  private async assertReportable(reporterId: string, targetType: ReportTarget, targetId: string) {
    if (targetType === 'listing') {
      const listing = await this.prisma.listing.findUnique({ where: { id: targetId }, select: { sellerId: true } });
      if (!listing) throw new NotFoundException('Лот не найден');
      if (listing.sellerId === reporterId) throw new BadRequestException('На свой лот жаловаться не нужно');
      return;
    }
    if (targetType === 'user') {
      const user = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!user) throw new NotFoundException('Пользователь не найден');
      if (user.id === reporterId) throw new BadRequestException('На себя жаловаться не нужно');
      return;
    }
    // Сообщение: жалуется участник диалога, а не любой, кто узнал id.
    const message = await this.prisma.message.findUnique({
      where: { id: targetId },
      select: { senderId: true, conversation: { select: { buyerId: true, sellerId: true } } },
    });
    const { buyerId, sellerId } = message?.conversation ?? {};
    if (!message || (buyerId !== reporterId && sellerId !== reporterId)) {
      throw new NotFoundException('Сообщение не найдено');
    }
    if (message.senderId === reporterId) throw new BadRequestException('На своё сообщение жаловаться не нужно');
  }

  // ── Очередь и обработка (модератор) ──

  /**
   * Очередь жалоб — одна карточка на цель: сколько жалоб, по каким
   * причинам, кто жаловался последним и что писал, и сама цель — лот,
   * сообщение или аккаунт со статусом нарушителя. Решение по цели закрывает
   * все её открытые жалобы, поэтому и решают по цели. Раньше каждая жалоба
   * шла своей карточкой: 250 жалоб на одного человека занимали 250 строк, и
   * жалобы на других уходили за них, а одно решение в «Решённых»
   * повторялось по числу жалоб.
   *
   * Открытые — по первой жалобе на цель, от старых к новым, чтобы никто не
   * ждал дольше всех; решённые и отклонённые — одно решение одной
   * карточкой, свежие сверху.
   */
  async listReports(q: ReportsQuery = {}) {
    const decided = q.status === 'resolved' || q.status === 'rejected';
    const limit = q.limit ?? 50;
    const statuses: ReportStatus[] = q.status ? [q.status] : OPEN;
    const inStatus = Prisma.sql`r.status::text = ANY(${statuses}::text[])`;
    const c = q.cursor;
    // Время в базе — UTC без пояса; id в курсоре — цель последней карточки.
    const at = c ? Prisma.sql`(${c.at.toISOString()}::timestamptz AT TIME ZONE 'UTC')` : Prisma.empty;
    // Одно решение — одна отметка времени у всех жалоб на цель: их меняет один запрос.
    const groups = await this.prisma.$queryRaw<ReportGroup[]>(
      decided
        ? Prisma.sql`
            SELECT r.target_type, r.target_id, r.handled_at, count(*)::int AS n,
                   min(r.created_at) AS first_at, max(r.created_at) AS last_at
            FROM reports r WHERE ${inStatus} ${c ? Prisma.sql`AND (r.handled_at, r.target_id) < (${at}, ${c!.id})` : Prisma.empty}
            GROUP BY r.handled_at, r.target_type, r.target_id
            ORDER BY r.handled_at DESC NULLS LAST, r.target_id DESC LIMIT ${limit + 1}`
        : Prisma.sql`
            SELECT r.target_type, r.target_id, NULL::timestamp AS handled_at, count(*)::int AS n,
                   min(r.created_at) AS first_at, max(r.created_at) AS last_at
            FROM reports r WHERE ${inStatus}
            GROUP BY r.target_type, r.target_id
            ${c ? Prisma.sql`HAVING (min(r.created_at), r.target_id) > (${at}, ${c!.id})` : Prisma.empty}
            ORDER BY first_at ASC, r.target_id ASC LIMIT ${limit + 1}`,
    );
    const page = groups.slice(0, limit);
    const key = (type: string, id: string, handledAt: Date | null) =>
      `${type}:${id}:${decided && handledAt ? handledAt.toISOString() : ''}`;
    const targetIds = [...new Set(page.map((g) => g.target_id))];
    const byHandled = decided ? Prisma.sql`, r.handled_at` : Prisma.empty;
    const idsOf = (t: ReportTarget) => [...new Set(page.filter((g) => g.target_type === t).map((g) => g.target_id))];
    const person = { select: { id: true, status: true, profile: { select: { username: true } } } };

    const [reasons, latest, listings, users, messages, open] = await Promise.all([
      this.prisma.$queryRaw<Array<{ target_type: string; target_id: string; handled_at: Date | null; reason: string; n: number }>>`
        SELECT r.target_type, r.target_id, ${decided ? Prisma.sql`r.handled_at` : Prisma.sql`NULL::timestamp`} AS handled_at,
               r.reason, count(*)::int AS n
        FROM reports r WHERE ${inStatus} AND r.target_id = ANY(${targetIds}::text[])
        GROUP BY r.target_type, r.target_id ${byHandled}, r.reason`,
      // Три последние жалобы карточки: кто, по какой причине и что написал.
      this.prisma.$queryRaw<
        Array<{ id: string; target_type: string; target_id: string; handled_at: Date | null; reporter_id: string; reason: string; details: string | null; created_at: Date }>
      >`
        SELECT id, target_type, target_id, handled_at, reporter_id, reason, details, created_at FROM (
          SELECT r.*, row_number() OVER (
            PARTITION BY r.target_type, r.target_id ${byHandled} ORDER BY r.created_at DESC, r.id DESC) AS rn
          FROM reports r WHERE ${inStatus} AND r.target_id = ANY(${targetIds}::text[])
        ) x WHERE rn <= 3`,
      this.prisma.listing.findMany({
        where: { id: { in: idsOf('listing').filter((id) => UUID.test(id)) } },
        select: { id: true, title: true, status: true, seller: person },
      }),
      this.prisma.user.findMany({ where: { id: { in: idsOf('user').filter((id) => UUID.test(id)) } }, ...person }),
      this.prisma.message.findMany({
        where: { id: { in: idsOf('message').filter((id) => UUID.test(id)) } },
        select: { id: true, body: true, conversationId: true, createdAt: true, sender: person },
      }),
      // Сколько ждёт решения — всегда; решённые — вся история, их не считаем.
      this.prisma.$queryRaw<Array<{ targets: number; reports: number }>>`
        SELECT count(DISTINCT (target_type, target_id))::int AS targets, count(*)::int AS reports
        FROM reports WHERE status::text = ANY(${OPEN}::text[])`,
    ]);
    const reporters = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(latest.map((r) => r.reporter_id))] } },
      select: { id: true, profile: { select: { username: true } } },
    });

    type Person = { id: string; status: UserStatus; profile: { username: string } | null };
    const who = (u: Person | null | undefined) =>
      u ? { id: u.id, username: u.profile?.username ?? null, status: u.status } : null;
    const listingById = new Map(listings.map((l) => [l.id, l]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const messageById = new Map(messages.map((m) => [m.id, m]));
    const reporterName = new Map(reporters.map((u) => [u.id, u.profile?.username ?? null]));

    const targetOf = (type: string, id: string) => {
      if (type === 'listing') {
        const l = listingById.get(id);
        return l ? { title: l.title, listingStatus: l.status, user: who(l.seller) } : null;
      }
      if (type === 'user') {
        const u = userById.get(id);
        return u ? { user: who(u) } : null;
      }
      const m = messageById.get(id);
      return m ? { text: m.body, conversationId: m.conversationId, sentAt: m.createdAt, user: who(m.sender) } : null;
    };

    const items = page.map((g) => {
      const k = key(g.target_type, g.target_id, g.handled_at);
      const mine = latest
        .filter((r) => key(r.target_type, r.target_id, r.handled_at) === k)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1));
      return {
        // Решение по любой жалобе карточки закрывает их все — берётся последняя.
        id: mine[0]?.id ?? null,
        targetType: g.target_type,
        targetId: g.target_id,
        status: decided ? q.status! : ('open' as const),
        handledAt: g.handled_at,
        reports: g.n,
        firstAt: g.first_at,
        lastAt: g.last_at,
        reasons: reasons
          .filter((r) => key(r.target_type, r.target_id, r.handled_at) === k)
          .map((r) => ({ reason: r.reason, count: r.n }))
          .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
        latest: mine.map((r) => ({
          reporter: reporterName.get(r.reporter_id) ?? null,
          reason: r.reason,
          details: r.details,
          createdAt: r.created_at,
        })),
        target: targetOf(g.target_type, g.target_id),
      };
    });
    const last = page[page.length - 1];
    const next =
      groups.length > limit && last ? nextCursor((decided ? last.handled_at : null) ?? last.first_at, last.target_id) : null;
    return { items, next, counts: { open: open[0]?.targets ?? 0, openReports: open[0]?.reports ?? 0 } };
  }

  /**
   * Решение по жалобе — сразу с действием над нарушителем. Одна цель —
   * одно решение: остальные открытые жалобы на неё закрываются тем же
   * статусом, и пожаловавшиеся узнают, что жалобу рассмотрели.
   */
  async handleReport(
    reportId: string,
    staffId: string,
    input: { status: ReportStatus; action?: ReportAction; note?: string },
  ) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Жалоба не найдена');
    if (input.action && input.status !== 'resolved') {
      throw new BadRequestException('Действие над нарушителем — только вместе с решением жалобы');
    }
    if (input.action) await this.applyAction(staffId, report, input.action, input.note || report.reason);

    const affected = await this.prisma.report.findMany({
      where:
        input.status === 'reviewing'
          ? { id: report.id }
          : { targetType: report.targetType, targetId: report.targetId, status: { in: OPEN } },
      select: { id: true, reporterId: true },
    });
    await this.prisma.report.updateMany({
      where: { id: { in: affected.map((a) => a.id) } },
      data: {
        status: input.status,
        handledBy: staffId,
        // «Взял в работу» — ещё не решение.
        ...(input.status === 'reviewing' ? {} : { handledAt: new Date() }),
      },
    });
    await this.audit.log({
      actorId: staffId,
      action: `report.${input.status}`,
      entityType: 'report',
      entityId: reportId,
      after: { reports: affected.length, action: input.action ?? null, note: input.note ?? null },
    });
    if (input.status !== 'reviewing') {
      for (const reporterId of new Set(affected.map((a) => a.reporterId))) {
        await this.notifications.notify(reporterId, 'report_handled', { status: input.status });
      }
    }
    return this.prisma.report.findUnique({ where: { id: reportId } });
  }

  private async applyAction(staffId: string, report: Report, action: ReportAction, reason: string) {
    if (action === 'block_listing') {
      if (report.targetType !== 'listing') throw new BadRequestException('Заблокировать можно только лот');
      await this.setListingStatus(staffId, report.targetId, 'blocked', reason);
      return;
    }
    const userId = await this.responsibleUser(report);
    if (!userId) throw new NotFoundException('Пользователь не найден');
    await this.setUserStatus(staffId, userId, action === 'ban_user' ? 'banned' : 'frozen', reason);
  }

  /** Кто отвечает за цель жалобы: продавец лота, автор сообщения, сам пользователь. */
  private async responsibleUser(report: Report): Promise<string | null> {
    if (report.targetType === 'user') return report.targetId;
    if (report.targetType === 'listing') {
      const l = await this.prisma.listing.findUnique({ where: { id: report.targetId }, select: { sellerId: true } });
      return l?.sellerId ?? null;
    }
    const m = await this.prisma.message.findUnique({ where: { id: report.targetId }, select: { senderId: true } });
    return m?.senderId ?? null;
  }

  // ── Поиск для консоли ──

  searchListings(q?: string, status?: ListingStatus) {
    const where: Prisma.ListingWhereInput = { status: status ?? { not: 'archived' } };
    const text = q?.trim();
    if (text) {
      where.OR = [
        ...(UUID.test(text) ? [{ id: text }] : []),
        { title: containsText(text) },
        { seller: { profile: { username: containsText(text) } } },
      ];
    }
    return this.prisma.listing.findMany({
      where,
      take: 50,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        price: true,
        currency: true,
        createdAt: true,
        game: { select: { title: true } },
        category: { select: { title: true } },
        seller: { select: { id: true, status: true, profile: { select: { username: true } } } },
      },
    });
  }

  async searchUsers(q?: string, status?: UserStatus) {
    const where: Prisma.UserWhereInput = status ? { status } : {};
    const text = q?.trim();
    if (text) {
      where.OR = [
        ...(UUID.test(text) ? [{ id: text }] : []),
        { email: containsText(text) },
        { profile: { username: containsText(text) } },
      ];
    }
    const rows = await this.prisma.user.findMany({
      where,
      take: 50,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        profile: { select: { username: true, salesCount: true, ratingAvg: true, ratingCount: true } },
        roles: { select: { role: { select: { key: true } } } },
      },
    });
    return rows.map(({ roles, ...u }) => ({ ...u, roles: roles.map((r) => r.role.key) }));
  }

  // ── Действия над лотами ──

  async setListingStatus(staffId: string, listingId: string, status: 'active' | 'blocked', reason?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Лот не найден');
    if (status === 'active' && listing.status !== 'blocked') throw new BadRequestException('Лот не заблокирован');
    // Снятая блокировка не выставляет лот без наличия: он вернётся «закончившимся».
    const next: ListingStatus = status === 'active' && listing.stock === 0 ? 'sold_out' : status;
    const updated = await this.prisma.listing.update({ where: { id: listingId }, data: { status: next } });
    await this.record(staffId, 'listing', listingId, status === 'blocked' ? 'block' : 'unblock', reason);
    await this.notifications.notify(listing.sellerId, status === 'blocked' ? 'listing_blocked' : 'listing_unblocked', {
      listingId,
      title: listing.title,
      ...(reason ? { reason } : {}),
    });
    return updated;
  }

  // ── Действия над пользователями ──

  /**
   * Заморозка и бан. Раньше менялась только строка в базе: забаненный
   * входил, его токены работали, лоты висели в каталоге. Теперь бан
   * отзывает сессии (и JwtAuthGuard не пускает с выданным токеном),
   * лоты уходят из каталога, а при снятии блокировки возвращаются те,
   * что сняла именно она.
   */
  async setUserStatus(staffId: string, userId: string, status: UserStatus, reason?: string) {
    if (userId === staffId) throw new BadRequestException('Свой аккаунт так не меняют');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, roles: { select: { role: { select: { key: true } } } } },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    // Сотрудника блокирует только администратор: иначе модератор снимает арбитра или админа.
    if (user.roles.some((r) => STAFF_ROLES.includes(r.role.key)) && !(await this.isAdmin(staffId))) {
      throw new ForbiddenException('Статус сотрудника меняет только администратор');
    }
    if (user.status === status) return { id: user.id, status };

    await this.prisma.user.update({ where: { id: userId }, data: { status } });
    let paused: string[] = [];
    if (status === 'active') {
      await this.restoreListings(userId);
    } else {
      const active = await this.prisma.listing.findMany({ where: { sellerId: userId, status: 'active' }, select: { id: true } });
      paused = active.map((l) => l.id);
      if (paused.length) {
        await this.prisma.listing.updateMany({ where: { id: { in: paused } }, data: { status: 'paused' } });
      }
    }
    if (status === 'banned') {
      await this.prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    const action = status === 'banned' ? 'ban' : status === 'frozen' ? 'block' : 'unblock';
    await this.record(staffId, 'user', userId, action, reason, { status, pausedListings: paused });
    await this.notifications.notify(userId, 'account_status', { status, ...(reason ? { reason } : {}) });
    return { id: user.id, status };
  }

  /** Вернуть в продажу лоты, которые сняла последняя блокировка, если продавец их не трогал. */
  private async restoreListings(userId: string) {
    const last = await this.prisma.auditLog.findFirst({
      where: { entityType: 'user', entityId: userId, action: { in: ['moderation.ban', 'moderation.block'] } },
      orderBy: { createdAt: 'desc' },
    });
    const ids = (last?.after as { pausedListings?: string[] } | null)?.pausedListings ?? [];
    if (!ids.length) return;
    await this.prisma.listing.updateMany({
      where: { id: { in: ids }, status: 'paused', OR: [{ stock: null }, { stock: { gt: 0 } }] },
      data: { status: 'active' },
    });
    await this.prisma.listing.updateMany({
      where: { id: { in: ids }, status: 'paused', stock: 0 },
      data: { status: 'sold_out' },
    });
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const n = await this.prisma.userRole.count({ where: { userId, role: { key: 'admin' } } });
    return n > 0;
  }

  private async record(
    actorId: string,
    targetType: string,
    targetId: string,
    action: 'warn' | 'block' | 'unblock' | 'ban' | 'hide' | 'delete',
    reason?: string,
    after?: Prisma.InputJsonValue,
  ) {
    await this.prisma.moderationAction.create({
      data: { actorId, targetType, targetId, action, reason },
    });
    await this.audit.log({
      actorId,
      action: `moderation.${action}`,
      entityType: targetType,
      entityId: targetId,
      after: { ...(after && typeof after === 'object' ? (after as object) : {}), ...(reason ? { reason } : {}) },
    });
  }
}
