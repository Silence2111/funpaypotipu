import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient, type SupportTicket } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { likeText } from '../../common/like';

/** Кто отвечает в поддержке. Администратору открыто всё. */
const SUPPORT_ROLES = ['agent', 'moderator', 'admin'];

export const SUPPORT_CATEGORIES = ['order', 'payment', 'account', 'selling', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const TICKET_STATUSES = ['open', 'answered', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Страница очереди: какие, что искать, с какого обращения продолжать. */
export interface QueueQuery {
  status?: TicketStatus;
  q?: string;
  /** Из `next` прошлой страницы: время последнего сообщения и id последнего показанного. */
  cursor?: { at: Date; id: string };
  limit?: number;
}

/**
 * Обращения в поддержку, как на FunPay: тема, раздел, заказ, переписка.
 * Статус показывает, чей ход: open — ждёт поддержку, answered — ждёт
 * пользователя, closed — закрыто (ответ пользователя открывает заново).
 */
@Injectable()
export class SupportService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string, input: { subject: string; category: SupportCategory; orderId?: string; body: string }) {
    if (input.orderId) {
      // Заказ — только свой: иначе в обращение подтягивались бы чужие сделки.
      const order = await this.prisma.order.findUnique({ where: { id: input.orderId }, select: { buyerId: true, sellerId: true } });
      if (!order || (order.buyerId !== userId && order.sellerId !== userId)) throw new NotFoundException('Заказ не найден');
    }
    // Пять открытых обращений — потолок: дальше это спам в очередь, а не вопросы.
    const open = await this.prisma.supportTicket.count({ where: { userId, status: { not: 'closed' } } });
    if (open >= 5) throw new BadRequestException('У вас уже пять открытых обращений — дождитесь ответа по ним');

    return this.prisma.supportTicket.create({
      data: {
        userId,
        subject: input.subject,
        category: input.category,
        orderId: input.orderId ?? null,
        messages: { create: { authorId: userId, body: input.body } },
      },
    });
  }

  listMine(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
  }

  /** Обращение с перепиской — автору и поддержке. Сотрудники подписаны «Поддержка». */
  async get(ticketId: string, userId: string) {
    const { ticket, staff } = await this.access(ticketId, userId);
    const [messages, owner, order] = await Promise.all([
      this.prisma.supportMessage.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.profile.findUnique({ where: { userId: ticket.userId }, select: { username: true } }),
      ticket.orderId
        ? this.prisma.order.findUnique({ where: { id: ticket.orderId }, select: { id: true, publicNumber: true, status: true } })
        : null,
    ]);
    return {
      ticket,
      isStaff: staff,
      owner: { id: ticket.userId, username: owner?.username ?? null },
      order,
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        fromStaff: m.fromStaff,
        mine: m.authorId === userId,
        createdAt: m.createdAt,
      })),
    };
  }

  async reply(ticketId: string, userId: string, body: string) {
    const { ticket, staff } = await this.access(ticketId, userId);
    const asStaff = staff && ticket.userId !== userId;
    await this.prisma.supportMessage.create({ data: { ticketId, authorId: userId, body, fromStaff: asStaff } });
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: asStaff ? 'answered' : 'open',
        lastMessageAt: new Date(),
        ...(asStaff && !ticket.assigneeId ? { assigneeId: userId } : {}),
      },
    });
    if (asStaff) await this.notifications.notify(ticket.userId, 'support_reply', { ticketId });
    return updated;
  }

  async close(ticketId: string, userId: string) {
    await this.access(ticketId, userId);
    return this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'closed' } });
  }

  /**
   * Очередь поддержки: ждущие ответа — старые сверху, чтобы никто не ждал
   * дольше всех, остальные — свежие сверху. По страницам, со счётчиками по
   * статусам; поиск — по теме, нику автора и номеру заказа. Раньше
   * отдавались 200 и всё: при очереди больше двухсот новые обращения
   * сотрудник не видел и не знал, сколько их, а закрытое старше двухсотого
   * было не найти.
   */
  async queue(q: QueueQuery = {}) {
    const status = q.status ?? 'open';
    const limit = q.limit ?? 50;
    const text = q.q?.trim().replace(/^[#@]+/, '');
    const pattern = `%${likeText(text ?? '')}%`;
    // Ветки по полям — каждая по своему индексу: тема — триграммы из
    // миграции support_search, автор — по найденным никам, заказ — по
    // найденным номерам (триграммы orders_search_trgm). Одним условием с «или»
    // база перебирала все обращения: на 20 тыс. — 15 мс, с соединением с
    // профилями и заказами — 30.
    const branches = text
      ? [
          Prisma.sql`t.subject ILIKE ${pattern}`,
          Prisma.sql`t.user_id IN (SELECT p.user_id FROM profiles p WHERE p.username ILIKE ${pattern})`,
          Prisma.sql`t.order_id IN (SELECT o.id FROM orders o WHERE o.public_number ILIKE ${pattern})`,
        ]
      : [Prisma.sql`TRUE`];
    // Ждущие ответа — от старых к новым, остальные — наоборот; курсор — то же
    // время и id. Время в базе — UTC без пояса.
    const asc = status === 'open';
    const dir = Prisma.raw(asc ? 'ASC' : 'DESC');
    const after = q.cursor
      ? Prisma.sql`AND (t.last_message_at, t.id) ${Prisma.raw(asc ? '>' : '<')}
          (${q.cursor.at.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${q.cursor.id}::uuid)`
      : Prisma.empty;
    const pageSql = Prisma.sql`
      SELECT id FROM (${Prisma.join(
        branches.map(
          (b) => Prisma.sql`(SELECT t.id, t.last_message_at FROM support_tickets t
            WHERE t.status = ${status} AND ${b} ${after}
            ORDER BY t.last_message_at ${dir}, t.id ${dir} LIMIT ${limit + 1})`,
        ),
        ' UNION ',
      )}) u
      ORDER BY last_message_at ${dir}, id ${dir} LIMIT ${limit + 1}`;
    // Закрытые — вся история обращений: их считаем только в поиске, где
    // ветки идут по индексам. Без поиска — ждущие, по индексу статуса.
    const countSql = text
      ? Prisma.sql`
          SELECT status, count(*)::int AS n FROM (${Prisma.join(
            branches.map((b) => Prisma.sql`SELECT t.id, t.status FROM support_tickets t WHERE ${b}`),
            ' UNION ',
          )}) u GROUP BY status`
      : Prisma.sql`
          SELECT t.status, count(*)::int AS n FROM support_tickets t
          WHERE t.status IN ('open', 'answered') GROUP BY t.status`;
    // В поиске какой индекс выгоднее, решает текст, а общий план
    // подготовленного запроса его не видит — план под каждый поиск.
    const [page, counted] = text
      ? await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('plan_cache_mode', 'force_custom_plan', true)`;
          return [
            await tx.$queryRaw<Array<{ id: string }>>(pageSql),
            await tx.$queryRaw<Array<{ status: string; n: number }>>(countSql),
          ] as const;
        })
      : await Promise.all([
          this.prisma.$queryRaw<Array<{ id: string }>>(pageSql),
          this.prisma.$queryRaw<Array<{ status: string; n: number }>>(countSql),
        ]);
    const count = (s: TicketStatus) => counted.find((c) => c.status === s)?.n ?? 0;
    const counts = { open: count('open'), answered: count('answered'), closed: text ? count('closed') : null };
    const ids = page.slice(0, limit).map((r) => r.id);
    const place = new Map(ids.map((id, i) => [id, i]));
    const tickets = (
      await this.prisma.supportTicket.findMany({
        where: { id: { in: ids } },
        include: { _count: { select: { messages: true } } },
      })
    ).sort((a, b) => place.get(a.id)! - place.get(b.id)!);
    const people = [...new Set(tickets.flatMap((t) => [t.userId, t.assigneeId].filter((v): v is string => !!v)))];
    const names = new Map(
      (await this.prisma.profile.findMany({ where: { userId: { in: people } }, select: { userId: true, username: true } })).map(
        (p) => [p.userId, p.username],
      ),
    );
    const items = tickets.map(({ _count, ...t }) => ({
      ...t,
      messages: _count.messages,
      user: names.get(t.userId) ?? null,
      assignee: t.assigneeId ? names.get(t.assigneeId) ?? null : null,
    }));
    const last = items[items.length - 1];
    const next = page.length > limit && last ? `${last.lastMessageAt.toISOString()}_${last.id}` : null;
    return { items, next, counts };
  }

  private async access(ticketId: string, userId: string): Promise<{ ticket: SupportTicket; staff: boolean }> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Обращение не найдено');
    const staff =
      (await this.prisma.userRole.count({ where: { userId, role: { key: { in: SUPPORT_ROLES } } } })) > 0;
    if (ticket.userId !== userId && !staff) throw new ForbiddenException('Это не ваше обращение');
    return { ticket, staff };
  }
}
