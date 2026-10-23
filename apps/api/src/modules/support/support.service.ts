import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, type SupportTicket } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';

/** Кто отвечает в поддержке. Администратору открыто всё. */
const SUPPORT_ROLES = ['agent', 'moderator', 'admin'];

export const SUPPORT_CATEGORIES = ['order', 'payment', 'account', 'selling', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export type TicketStatus = 'open' | 'answered' | 'closed';

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

  /** Очередь поддержки: по умолчанию — ждущие ответа, старые сверху. */
  async queue(status: TicketStatus = 'open') {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { status },
      orderBy: { lastMessageAt: status === 'open' ? 'asc' : 'desc' },
      take: 200,
      include: { _count: { select: { messages: true } } },
    });
    const ids = [...new Set(tickets.flatMap((t) => [t.userId, t.assigneeId].filter((v): v is string => !!v)))];
    const names = new Map(
      (await this.prisma.profile.findMany({ where: { userId: { in: ids } }, select: { userId: true, username: true } })).map(
        (p) => [p.userId, p.username],
      ),
    );
    return tickets.map(({ _count, ...t }) => ({
      ...t,
      messages: _count.messages,
      user: names.get(t.userId) ?? null,
      assignee: t.assigneeId ? names.get(t.assigneeId) ?? null : null,
    }));
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
