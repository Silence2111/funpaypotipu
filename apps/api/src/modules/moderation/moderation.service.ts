import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  type ListingStatus,
  type ModerationActionType,
  type Report,
  type ReportStatus,
  type UserStatus,
} from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { containsText, likeText } from '../../common/like';
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
  /** Ник нарушителя или пожаловавшегося, название лота, id цели или жалобы. */
  q?: string;
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

/** Фильтры лотов в консоли. «Сняты» — как в кабинете продавца: снятые и черновики. */
export const LISTING_FILTERS = ['active', 'paused', 'sold_out', 'blocked', 'archived'] as const;
export type ListingFilter = (typeof LISTING_FILTERS)[number];
const LISTING_FILTER: Record<ListingFilter, ListingStatus[]> = {
  active: ['active'],
  paused: ['paused', 'draft'],
  sold_out: ['sold_out'],
  blocked: ['blocked'],
  archived: ['archived'],
};
/** «Все» — без архива: удалённые продавцом лоты модератору не нужны. */
const NOT_ARCHIVED: ListingStatus[] = ['draft', 'active', 'paused', 'sold_out', 'blocked'];

/** Фильтры пользователей: статусы и «Сотрудники» — у кого есть роль сотрудника. */
export const USER_FILTERS = ['active', 'frozen', 'banned', 'staff'] as const;
export type UserFilter = (typeof USER_FILTERS)[number];
const STAFF_WHERE: Prisma.UserWhereInput = { roles: { some: { role: { key: { in: STAFF_ROLES } } } } };

/** Страница лотов: статус, продавец, поиск, с какого лота продолжать. */
export interface ListingsQuery {
  status?: ListingFilter;
  seller?: string;
  q?: string;
  cursor?: { at: Date; id: string };
  limit?: number;
}

/** Страница пользователей: статус или «Сотрудники», поиск, с кого продолжать. */
export interface UsersQuery {
  status?: UserFilter;
  q?: string;
  cursor?: { at: Date; id: string };
  limit?: number;
}

/** Решение модератора по лоту или пользователю: что, когда, кто, почему. */
type Decision = { action: ModerationActionType; at: Date; by: string | null; reason: string | null };

/** Сколько найденных по нику людей подставляется в запрос списком id. */
const FEW_PEOPLE = 200;

/** Текст поиска: «@» перед ником и «#» перед номером не мешают. */
const searchText = (q?: string) => q?.trim().replace(/^[#@]+/, '') || undefined;

/**
 * Строки старше курсора — для списков «свежие сверху». Лишнее
 * `createdAt <= …` даёт базе границу по индексу: без него она листает
 * список с самого начала до курсора.
 */
const olderThan = (c?: { at: Date; id: string }) =>
  c ? { createdAt: { lte: c.at }, OR: [{ createdAt: { lt: c.at } }, { id: { lt: c.id } }] } : {};

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
    const text = searchText(q.q);
    const targets = text ? await this.reportTargets(text) : null;
    // Поиск отбирает цели, а карточка — все жалобы цели в этом статусе: иначе
    // найденная по пожаловавшемуся карточка показала бы одну его жалобу.
    const found = (among: ReportStatus[]) =>
      targets ? Prisma.sql`AND (r.target_type, r.target_id) IN (${targets(among)})` : Prisma.empty;
    const inStatus = Prisma.sql`r.status::text = ANY(${statuses}::text[]) ${found(statuses)}`;
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
      // Сколько ждёт решения — всегда, в поиске — найденных; решённые — вся
      // история, их не считаем.
      this.prisma.$queryRaw<Array<{ targets: number; reports: number }>>`
        SELECT count(DISTINCT (r.target_type, r.target_id))::int AS targets, count(*)::int AS reports
        FROM reports r WHERE r.status::text = ANY(${OPEN}::text[]) ${found(OPEN)}`,
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

  // ── Лоты и пользователи в консоли ──

  /**
   * Лоты для модератора — по 50 и «Показать ещё», свежие сверху. Фильтры
   * по статусу со счётчиками, лоты одного продавца, поиск по названию, нику
   * продавца и id. У заблокированного — когда, кто и за что. Раньше
   * приходили 50 последних без продолжения и без счётчиков: лот старше
   * пятидесяти свежих находился только поиском, а за что его
   * заблокировали, в консоли не было.
   */
  async listListings(q: ListingsQuery = {}) {
    const limit = q.limit ?? 50;
    const text = searchText(q.q);
    const scope: Prisma.ListingWhereInput[] = [];
    if (q.seller) scope.push({ sellerId: q.seller });
    if (text) {
      scope.push({
        OR: [
          ...(UUID.test(text) ? [{ id: text.toLowerCase() }] : []),
          { title: containsText(text) },
          await this.sellersNamed(text),
        ],
      });
    }
    const status: Prisma.ListingWhereInput = q.status
      ? { status: { in: LISTING_FILTER[q.status] } }
      : { status: { not: 'archived' } };
    const [page, grouped, seller] = await Promise.all([
      this.prisma.listing.findMany({
        where: { AND: [...scope, status, olderThan(q.cursor)] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          title: true,
          status: true,
          price: true,
          currency: true,
          stock: true,
          createdAt: true,
          game: { select: { title: true } },
          category: { select: { title: true } },
          seller: { select: { id: true, status: true, profile: { select: { username: true } } } },
        },
      }),
      this.prisma.listing.groupBy({ by: ['status'], where: { AND: scope }, _count: { _all: true } }),
      q.seller
        ? this.prisma.profile.findUnique({ where: { userId: q.seller }, select: { username: true } })
        : null,
    ]);
    const rows = page.slice(0, limit);
    const blocks = await this.lastDecisions(
      'listing',
      rows.filter((l) => l.status === 'blocked').map((l) => l.id),
      ['block', 'unblock'],
    );
    const n = (s: ListingStatus) => grouped.find((g) => g.status === s)?._count._all ?? 0;
    const last = rows[rows.length - 1];
    return {
      items: rows.map((l) => {
        const d = blocks.get(l.id);
        return { ...l, block: d?.action === 'block' ? { at: d.at, by: d.by, reason: d.reason } : null };
      }),
      next: page.length > limit && last ? nextCursor(last.createdAt, last.id) : null,
      counts: {
        all: NOT_ARCHIVED.reduce((sum, s) => sum + n(s), 0),
        active: n('active'),
        paused: n('paused') + n('draft'),
        sold_out: n('sold_out'),
        blocked: n('blocked'),
        archived: n('archived'),
      },
      seller: q.seller ? { id: q.seller, username: seller?.username ?? null } : null,
    };
  }

  /**
   * Пользователи — по 50 и «Показать ещё», новые сверху. Фильтры по
   * статусу и «Сотрудники» со счётчиками, поиск по нику, почте и id. У
   * замороженного и забаненного — когда, кто и за что; у каждого — когда
   * заходил и сколько лотов в продаже. Раньше — 50 последних
   * зарегистрированных без продолжения и счётчиков.
   */
  async listUsers(q: UsersQuery = {}) {
    const limit = q.limit ?? 50;
    const text = searchText(q.q);
    const match: Prisma.UserWhereInput = text
      ? {
          OR: [
            ...(UUID.test(text) ? [{ id: text.toLowerCase() }] : []),
            { email: containsText(text) },
            await this.peopleNamed(text),
          ],
        }
      : {};
    const filter: Prisma.UserWhereInput =
      q.status === 'staff' ? STAFF_WHERE : q.status ? { status: q.status } : {};
    const [page, grouped, staff] = await Promise.all([
      this.prisma.user.findMany({
        where: { AND: [match, filter, olderThan(q.cursor)] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
          // Когда был на сайте: время входа не пишется, а «в сети» отмечает каждый запрос.
          profile: { select: { username: true, salesCount: true, ratingAvg: true, ratingCount: true, onlineAt: true } },
          roles: { select: { role: { select: { key: true } } } },
        },
      }),
      this.prisma.user.groupBy({ by: ['status'], where: match, _count: { _all: true } }),
      this.prisma.user.count({ where: { AND: [match, STAFF_WHERE] } }),
    ]);
    const rows = page.slice(0, limit);
    const [decisions, lots] = await Promise.all([
      this.lastDecisions(
        'user',
        rows.filter((u) => u.status !== 'active').map((u) => u.id),
        ['block', 'ban', 'unblock'],
      ),
      rows.length
        ? this.prisma.listing.groupBy({
            by: ['sellerId'],
            where: { sellerId: { in: rows.map((u) => u.id) }, status: 'active' },
            _count: { _all: true },
          })
        : [],
    ]);
    const active = new Map(lots.map((l) => [l.sellerId, l._count._all]));
    const n = (s: UserStatus) => grouped.find((g) => g.status === s)?._count._all ?? 0;
    const last = rows[rows.length - 1];
    return {
      items: rows.map(({ roles, ...u }) => {
        const d = decisions.get(u.id);
        // Ограничение — последнее решение модератора, если статус ему и
        // соответствует: заморозка — `block`, бан — `ban`.
        const current = d && ((u.status === 'frozen' && d.action === 'block') || (u.status === 'banned' && d.action === 'ban'));
        return {
          ...u,
          roles: roles.map((r) => r.role.key),
          activeListings: active.get(u.id) ?? 0,
          restriction: current ? { at: d.at, by: d.by, reason: d.reason } : null,
        };
      }),
      next: page.length > limit && last ? nextCursor(last.createdAt, last.id) : null,
      counts: {
        all: n('active') + n('frozen') + n('banned'),
        active: n('active'),
        frozen: n('frozen'),
        banned: n('banned'),
        staff,
      },
    };
  }

  /**
   * Пользователи с ником, в котором есть текст. Нашлось немного — списком
   * id: база берёт их по ключу. Нашлись тысячи — условием по профилю,
   * чтобы не передавать в запрос тысячи id.
   */
  private async peopleNamed(text: string): Promise<Prisma.UserWhereInput> {
    const ids = await this.idsNamed(text);
    return ids ? { id: { in: ids } } : { profile: { username: containsText(text) } };
  }

  /** То же для лотов: по продавцам с таким ником. */
  private async sellersNamed(text: string): Promise<Prisma.ListingWhereInput> {
    const ids = await this.idsNamed(text);
    return ids ? { sellerId: { in: ids } } : { seller: { profile: { username: containsText(text) } } };
  }

  /**
   * Цели жалоб, подходящие под поиск, — пары «тип, цель»: аккаунт с таким
   * ником; лот с таким названием или от такого продавца; сообщение такого
   * автора; цели, на которые жаловался человек с таким ником; цель или
   * жалоба с таким id. Каждая ветка берётся по своему индексу, и только
   * потом — жалобы этих целей. Раньше условие проверялось у каждой жалобы
   * подзапросами: на 100 тыс. решённых — 1–2 с на поиск.
   */
  private async reportTargets(text: string): Promise<(among: ReportStatus[]) => Prisma.Sql> {
    const like = `%${likeText(text)}%`;
    const ids = await this.idsNamed(text);
    const who = ids
      ? Prisma.sql`SELECT unnest(${ids}::uuid[]) AS id`
      : Prisma.sql`SELECT p.user_id AS id FROM profiles p WHERE p.username ILIKE ${like}`;
    const id = UUID.test(text) ? text.toLowerCase() : null;
    return (among) => {
      const inStatus = Prisma.sql`r3.status::text = ANY(${among}::text[])`;
      const parts = [
        Prisma.sql`SELECT 'user'::text, w.id::text FROM who w`,
        Prisma.sql`SELECT 'listing'::text, l.id::text FROM listings l
          WHERE l.title ILIKE ${like} OR l.seller_id IN (SELECT id FROM who)`,
        Prisma.sql`SELECT r3.target_type, r3.target_id FROM reports r3
          WHERE r3.reporter_id IN (SELECT id FROM who) AND ${inStatus}`,
        // Индекса по автору у сообщений нет — от жалоб на сообщения, их мало.
        // Цель — строка: в uuid переводится, только если она им и выглядит.
        Prisma.sql`SELECT r3.target_type, r3.target_id FROM reports r3
          JOIN messages m ON m.id = (CASE WHEN r3.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN r3.target_id::uuid END)
          WHERE r3.target_type = 'message' AND ${inStatus} AND m.sender_id IN (SELECT id FROM who)`,
      ];
      if (id) {
        parts.push(
          Prisma.sql`SELECT t, ${id}::text FROM unnest(ARRAY['listing', 'user', 'message']) t`,
          Prisma.sql`SELECT r3.target_type, r3.target_id FROM reports r3 WHERE r3.id = ${id}::uuid`,
        );
      }
      return Prisma.sql`WITH who AS MATERIALIZED (${who}) ${Prisma.join(parts, ' UNION ')}`;
    };
  }

  private async idsNamed(text: string): Promise<string[] | null> {
    const found = await this.prisma.profile.findMany({
      where: { username: containsText(text) },
      select: { userId: true },
      take: FEW_PEOPLE + 1,
    });
    return found.length > FEW_PEOPLE ? null : found.map((p) => p.userId);
  }

  /** Последнее из решений модератора по каждой цели — когда, кто и с какой причиной. */
  private async lastDecisions(targetType: 'listing' | 'user', ids: string[], actions: ModerationActionType[]) {
    if (!ids.length) return new Map<string, Decision>();
    const rows = await this.prisma.moderationAction.findMany({
      where: { targetType, targetId: { in: ids }, action: { in: actions } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { targetId: true, action: true, actorId: true, reason: true, createdAt: true },
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.targetId)) latest.set(r.targetId, r);
    const actorIds = [...new Set([...latest.values()].map((r) => r.actorId).filter((v): v is string => !!v))];
    const names = new Map(
      (
        await this.prisma.profile.findMany({ where: { userId: { in: actorIds } }, select: { userId: true, username: true } })
      ).map((p) => [p.userId, p.username]),
    );
    return new Map<string, Decision>(
      [...latest].map(([id, r]) => [
        id,
        { action: r.action, at: r.createdAt, by: r.actorId ? (names.get(r.actorId) ?? null) : null, reason: r.reason },
      ]),
    );
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
