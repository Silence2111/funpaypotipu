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
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type DisputeStatus } from '@gamemarket/db';
import { DISPUTE_NOTES, DISPUTE_REMIND_HOURS, DISPUTE_RESPONSE_HOURS } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { OrdersService } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../access/audit.service';
import { StorageService } from '../storage/storage.service';
import { ScanService } from '../antivirus/scan.service';

const STAFF_ROLES = ['agent', 'moderator', 'admin'];
const OPEN: DisputeStatus[] = ['open', 'in_review'];

/** Часов на ответ стороне; меняется только для проверок. */
const RESPONSE_HOURS = Number(process.env.DISPUTE_RESPONSE_HOURS ?? DISPUTE_RESPONSE_HOURS);
const respondBy = () => new Date(Date.now() + RESPONSE_HOURS * 3600_000);
/** Как часто проверять сроки ответа — вместе с таймерами сделок. */
const SWEEP_MS = Number(
  process.env.DISPUTE_SWEEP_INTERVAL_MS ?? process.env.ORDER_SWEEP_INTERVAL_MS ?? 60_000,
);

type Side = 'buyer' | 'seller';

interface DisputeAttachment {
  key: string;
  mime: string;
  size: number;
}

@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly scanner: ScanService,
  ) {}

  async open(orderId: string, userId: string, reason: string) {
    const existing = await this.prisma.dispute.findUnique({ where: { orderId } });
    if (existing) throw new ConflictException('Спор по этому заказу уже открыт');

    const order = await this.orders.markDisputed(orderId, userId); // проверит участие/переход
    // Вторая сторона отвечает в срок: молчание видно арбитру и поднимает спор в очереди.
    const dispute = await this.prisma.dispute.create({
      data: {
        orderId,
        openedBy: userId,
        reason,
        status: 'open',
        awaitingFrom: order.buyerId === userId ? 'seller' : 'buyer',
        respondBy: respondBy(),
      },
    });

    const counterparty = order.buyerId === userId ? order.sellerId : order.buyerId;
    await this.notifications.notify(counterparty, 'dispute_opened', { orderId, disputeId: dispute.id });
    return dispute;
  }

  /** Presigned PUT для загрузки доказательства-файла в спор. */
  async requestUpload(disputeId: string, userId: string, mime: string) {
    await this.accessible(disputeId, userId);
    if (!this.storage.enabled) throw new NotFoundException('Хранилище недоступно');
    const ext = mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
    const key = `disputes/${disputeId}/${randomUUID()}.${ext}`;
    return { key, uploadUrl: await this.storage.presignPut(key) };
  }

  async addMessage(
    disputeId: string,
    userId: string,
    body: string,
    isInternal = false,
    attachments: DisputeAttachment[] = [],
  ) {
    const { dispute, order, isStaff } = await this.accessible(disputeId, userId);
    if (isInternal && !isStaff) throw new ForbiddenException('Внутренние заметки — только арбитр');
    if (!body.trim() && attachments.length === 0) {
      throw new BadRequestException('Пустое сообщение');
    }

    // Антивирус-скан каждого вложения; заражённые отсекаем.
    for (const a of attachments) await this.scan(a.key);

    const msg = await this.prisma.disputeMessage.create({
      data: {
        disputeId: dispute.id,
        senderId: userId,
        body,
        isInternal: isInternal && isStaff,
        attachments: attachments.length
          ? (attachments as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });

    // Сторона, от которой ждали ответа, ответила — ход больше не за ней.
    const side = order?.buyerId === userId ? 'buyer' : order?.sellerId === userId ? 'seller' : null;
    if (!isInternal && side && dispute.awaitingFrom === side) {
      await this.prisma.dispute.updateMany({
        where: { id: dispute.id, awaitingFrom: side },
        data: { awaitingFrom: null, respondBy: null },
      });
    }

    // Уведомляем вторую сторону (не для внутренних заметок арбитра).
    if (!(isInternal && isStaff) && order) {
      const other = order.buyerId === userId ? order.sellerId : order.buyerId;
      if (other && other !== userId) {
        await this.notifications.notify(other, 'dispute_opened', {
          orderId: dispute.orderId,
          disputeId: dispute.id,
        });
      }
    }
    return msg;
  }

  private async scan(key: string): Promise<void> {
    if (!this.storage.enabled) return;
    const result = await this.scanner.scan(await this.storage.getBytes(key));
    if (!result.clean) {
      await this.storage.remove(key);
      throw new BadRequestException(`Файл не прошёл антивирус-проверку: ${result.reason}`);
    }
  }

  /** Сообщение площадки в споре (senderId = null). */
  private note(disputeId: string, body: string) {
    return this.prisma.disputeMessage.create({ data: { disputeId, senderId: null, body } });
  }

  /**
   * Арбитр просит пояснений у стороны: у неё снова срок на ответ, ей —
   * уведомление. Спор при этом переходит в работу к этому арбитру.
   */
  async request(disputeId: string, arbiterId: string, side: Side) {
    const dispute = await this.get(disputeId);
    if (!OPEN.includes(dispute.status)) throw new ConflictException('Спор уже разрешён');
    const order = await this.prisma.order.findUnique({ where: { id: dispute.orderId } });
    const until = respondBy();
    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'in_review',
        arbiterId: dispute.arbiterId ?? arbiterId,
        awaitingFrom: side,
        respondBy: until,
      },
    });
    await this.note(disputeId, side === 'seller' ? DISPUTE_NOTES.askSeller : DISPUTE_NOTES.askBuyer);
    if (order) {
      await this.notifications.notify(side === 'seller' ? order.sellerId : order.buyerId, 'dispute_reply_needed', {
        orderId: order.id,
        disputeId,
        respondBy: until.toISOString(),
      });
    }
    await this.audit.log({
      actorId: arbiterId,
      action: 'dispute.request',
      entityType: 'dispute',
      entityId: disputeId,
      after: { side } as Prisma.InputJsonValue,
    });
    return updated;
  }

  /**
   * Покупатель закрывает спор сам: претензий нет, деньги — продавцу, как при
   * подтверждении получения. Спор занимается первым: второй клик не проведёт
   * его дважды, а сбой подтверждения возвращает спор как был.
   */
  async withdraw(disputeId: string, userId: string) {
    const { dispute, order } = await this.accessible(disputeId, userId);
    if (!order || order.buyerId !== userId) {
      throw new ForbiddenException('Закрыть спор без претензий может только покупатель');
    }
    const before = {
      status: dispute.status,
      awaitingFrom: dispute.awaitingFrom,
      respondBy: dispute.respondBy,
    };
    const claimed = await this.prisma.dispute.updateMany({
      where: { id: disputeId, status: { in: OPEN } },
      data: { status: 'cancelled', resolvedAt: new Date(), awaitingFrom: null, respondBy: null },
    });
    if (!claimed.count) throw new ConflictException('Спор уже разрешён');
    try {
      await this.orders.confirm(order.id, userId);
    } catch (e) {
      await this.prisma.dispute.update({
        where: { id: disputeId },
        data: { ...before, resolvedAt: null },
      });
      throw e;
    }
    await this.note(disputeId, DISPUTE_NOTES.withdrawn);
    await this.notifications.notify(order.sellerId, 'dispute_resolved', { disputeId, outcome: 'seller' });
    return { ok: true };
  }

  /**
   * Срок ответа подходит к концу — напоминаем стороне один раз; прошёл —
   * отмечаем, кто промолчал, и пишем об этом в спор. Деньги сами не
   * двигаются: решает арбитр, молчание — довод для него.
   */
  @Interval('disputes-deadlines', SWEEP_MS)
  async sweep(now = new Date()) {
    await this.remind(now);
    const due = await this.prisma.dispute.findMany({
      where: { status: { in: OPEN }, awaitingFrom: { not: null }, respondBy: { lt: now } },
      take: 100,
    });
    for (const d of due) {
      try {
        const r = await this.prisma.dispute.updateMany({
          where: { id: d.id, respondBy: d.respondBy },
          data: { missedBy: d.awaitingFrom, missedAt: now, respondBy: null },
        });
        if (r.count) {
          await this.note(d.id, d.awaitingFrom === 'seller' ? DISPUTE_NOTES.missedSeller : DISPUTE_NOTES.missedBuyer);
        }
      } catch (e) {
        this.logger.warn(`Срок ответа в споре ${d.id}: ${(e as Error).message}`);
      }
    }
  }

  /** Арбитр берёт спор в работу (роут под RolesGuard('agent')). */
  /**
   * Напоминание за DISPUTE_REMIND_HOURS до конца срока — тому, чей ход.
   * Запоминаем, о каком сроке напомнили: второй экземпляр API не продублирует,
   * а новый срок от арбитра напомнит снова.
   */
  private async remind(now: Date) {
    const soon = await this.prisma.dispute.findMany({
      where: {
        status: { in: OPEN },
        awaitingFrom: { not: null },
        respondBy: { gt: now, lte: new Date(now.getTime() + DISPUTE_REMIND_HOURS * 3600_000) },
      },
      orderBy: { respondBy: 'asc' },
      take: 100,
    });
    for (const d of soon) {
      if (d.remindedFor?.getTime() === d.respondBy?.getTime()) continue;
      try {
        const r = await this.prisma.dispute.updateMany({
          where: { id: d.id, respondBy: d.respondBy, remindedFor: d.remindedFor },
          data: { remindedFor: d.respondBy },
        });
        if (!r.count) continue;
        const order = await this.prisma.order.findUnique({
          where: { id: d.orderId },
          select: { id: true, buyerId: true, sellerId: true, publicNumber: true, listingSnapshot: true },
        });
        if (!order) continue;
        const title = (order.listingSnapshot as { title?: string } | null)?.title;
        await this.notifications.notify(
          d.awaitingFrom === 'seller' ? order.sellerId : order.buyerId,
          'dispute_reply_soon',
          {
            orderId: order.id,
            disputeId: d.id,
            respondBy: d.respondBy!.toISOString(),
            preview: title ? `${order.publicNumber} · ${title}` : order.publicNumber,
          },
        );
      } catch (e) {
        this.logger.warn(`Напоминание о сроке в споре ${d.id}: ${(e as Error).message}`);
      }
    }
  }

  async take(disputeId: string, arbiterId: string) {
    const dispute = await this.get(disputeId);
    if (dispute.status !== 'open') throw new ConflictException('Спор уже в работе или закрыт');
    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status: 'in_review', arbiterId },
    });
  }

  /** Решение арбитра: деньги двигаются через OrdersService. */
  async resolve(disputeId: string, arbiterId: string, outcome: 'seller' | 'buyer', note?: string) {
    const dispute = await this.get(disputeId);
    if (dispute.status !== 'in_review' && dispute.status !== 'open') {
      throw new ConflictException('Спор уже разрешён');
    }

    await this.orders.applyDisputeResolution(dispute.orderId, outcome);
    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: outcome === 'seller' ? 'resolved_seller' : 'resolved_buyer',
        arbiterId,
        resolutionNote: note,
        resolvedAt: new Date(),
        awaitingFrom: null,
        respondBy: null,
      },
    });

    await this.audit.log({
      actorId: arbiterId,
      action: `dispute.resolve.${outcome}`,
      entityType: 'dispute',
      entityId: disputeId,
      after: { outcome, orderId: dispute.orderId } as Prisma.InputJsonValue,
    });

    const order = await this.prisma.order.findUnique({ where: { id: dispute.orderId } });
    if (order) {
      await this.notifications.notify(order.buyerId, 'dispute_resolved', { disputeId, outcome });
      await this.notifications.notify(order.sellerId, 'dispute_resolved', { disputeId, outcome });
    }
    return updated;
  }

  /**
   * Спор с перепиской и сторонами. Арбитру нужно видеть, кто есть кто и о
   * какой сумме спор: раньше страница спора отдавала одни сообщения без
   * подписей, и арбитр решал вслепую.
   */
  async getForUser(disputeId: string, userId: string) {
    const { dispute, order, isStaff } = await this.accessible(disputeId, userId);
    const rows = await this.prisma.disputeMessage.findMany({
      where: { disputeId, ...(isStaff ? {} : { isInternal: false }) },
      orderBy: { createdAt: 'asc' },
    });
    const messages = await Promise.all(
      rows.map(async (m) => ({
        id: m.id,
        senderId: m.senderId,
        body: m.body,
        isInternal: m.isInternal,
        createdAt: m.createdAt,
        attachments: await this.presignAttachments(m.attachments),
      })),
    );
    const names = await this.usernames([order?.buyerId, order?.sellerId, dispute.arbiterId]);
    // Решает спор арбитр или администратор; модератор видит переписку, но денег не двигает.
    const canResolve =
      isStaff &&
      (await this.prisma.userRole.count({ where: { userId, role: { key: { in: ['agent', 'admin'] } } } })) > 0;
    return {
      dispute,
      messages,
      isStaff,
      canResolve,
      // Сторона спора: покупателю — «претензий нет», продавцу — «вернуть деньги».
      side: order?.buyerId === userId ? 'buyer' : order?.sellerId === userId ? 'seller' : null,
      order: order
        ? {
            id: order.id,
            publicNumber: order.publicNumber,
            amount: order.amount,
            currency: order.currency,
            status: order.status,
            title: (order.listingSnapshot as { title?: string } | null)?.title ?? null,
          }
        : null,
      parties: {
        buyer: order ? { id: order.buyerId, username: names.get(order.buyerId) ?? null } : null,
        seller: order ? { id: order.sellerId, username: names.get(order.sellerId) ?? null } : null,
        arbiter: dispute.arbiterId ? { id: dispute.arbiterId, username: names.get(dispute.arbiterId) ?? null } : null,
      },
    };
  }

  private async usernames(ids: Array<string | null | undefined>) {
    const list = [...new Set(ids.filter((v): v is string => !!v))];
    const rows = await this.prisma.profile.findMany({
      where: { userId: { in: list } },
      select: { userId: true, username: true },
    });
    return new Map(rows.map((r) => [r.userId, r.username]));
  }

  /**
   * Споры человека — и как покупателя, и как продавца. Открытые: сначала те,
   * где ход за ним, с ближайшим сроком; закрытые — свежие сверху. Рядом —
   * сколько открытых, закрытых и ждущих его ответа, для вкладок.
   */
  async mine(userId: string, state: 'open' | 'closed' = 'open') {
    const mine: Prisma.DisputeWhereInput = {
      order: { OR: [{ buyerId: userId }, { sellerId: userId }] },
    };
    const [rows, open, closed, myTurn] = await Promise.all([
      this.prisma.dispute.findMany({
        where: { ...mine, status: state === 'open' ? { in: OPEN } : { notIn: OPEN } },
        orderBy: state === 'open' ? { createdAt: 'desc' } : [{ resolvedAt: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        include: {
          order: {
            select: {
              id: true,
              publicNumber: true,
              amount: true,
              currency: true,
              buyerId: true,
              sellerId: true,
              listingSnapshot: true,
            },
          },
        },
      }),
      this.prisma.dispute.count({ where: { ...mine, status: { in: OPEN } } }),
      this.prisma.dispute.count({ where: { ...mine, status: { notIn: OPEN } } }),
      this.prisma.dispute.count({
        where: {
          status: { in: OPEN },
          OR: [
            { awaitingFrom: 'buyer', order: { buyerId: userId } },
            { awaitingFrom: 'seller', order: { sellerId: userId } },
          ],
        },
      }),
    ]);
    const names = await this.usernames(rows.flatMap((d) => [d.order.buyerId, d.order.sellerId]));
    const items = rows.map(({ order, ...d }) => {
      const side: Side = order.buyerId === userId ? 'buyer' : 'seller';
      return {
        id: d.id,
        status: d.status,
        reason: d.reason,
        createdAt: d.createdAt,
        resolvedAt: d.resolvedAt,
        awaitingFrom: d.awaitingFrom,
        respondBy: d.respondBy,
        missedBy: d.missedBy,
        side,
        myTurn: OPEN.includes(d.status) && d.awaitingFrom === side,
        order: {
          id: order.id,
          publicNumber: order.publicNumber,
          amount: order.amount,
          currency: order.currency,
          title: (order.listingSnapshot as { title?: string } | null)?.title ?? null,
        },
        counterpart: names.get(side === 'buyer' ? order.sellerId : order.buyerId) ?? null,
      };
    });
    // Где ждут ответа от этого человека — наверх, ближайший срок первым.
    if (state === 'open') {
      const due = (d: (typeof items)[number]) => d.respondBy?.getTime() ?? Infinity;
      items.sort((a, b) => Number(b.myTurn) - Number(a.myTurn) || due(a) - due(b));
    }
    return { items, counts: { open, closed, myTurn } };
  }

  /** Найти спор пользователя по заказу (для перехода со страницы заказа). */
  async findByOrder(orderId: string, userId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { orderId } });
    if (!dispute) throw new NotFoundException('Спор не найден');
    await this.accessible(dispute.id, userId);
    return { id: dispute.id };
  }

  private async presignAttachments(raw: Prisma.JsonValue | null) {
    if (!Array.isArray(raw) || !this.storage.enabled) return [];
    const list = raw as unknown as DisputeAttachment[];
    return Promise.all(
      list.map(async (a) => ({ url: await this.storage.presignGet(a.key), mime: a.mime })),
    );
  }

  /** Очередь арбитра: сумма, стороны, кто взял, сколько ждёт. */
  async queue() {
    const disputes = await this.prisma.dispute.findMany({
      where: { status: { in: ['open', 'in_review'] } },
      orderBy: { createdAt: 'asc' },
      include: {
        order: {
          select: { publicNumber: true, amount: true, currency: true, buyerId: true, sellerId: true, listingSnapshot: true },
        },
        _count: { select: { messages: true } },
      },
    });
    const names = await this.usernames(
      disputes.flatMap((d) => [d.order?.buyerId, d.order?.sellerId, d.arbiterId]),
    );
    // Кто промолчал — наверх: такой спор можно решать по тому, что есть.
    disputes.sort((a, b) => Number(!!b.missedBy) - Number(!!a.missedBy));
    return disputes.map(({ order, _count, ...d }) => ({
      ...d,
      messages: _count.messages,
      order: order
        ? {
            publicNumber: order.publicNumber,
            amount: order.amount,
            currency: order.currency,
            title: (order.listingSnapshot as { title?: string } | null)?.title ?? null,
          }
        : null,
      buyer: order ? names.get(order.buyerId) ?? null : null,
      seller: order ? names.get(order.sellerId) ?? null : null,
      arbiter: d.arbiterId ? names.get(d.arbiterId) ?? null : null,
    }));
  }

  private async get(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Спор не найден');
    return dispute;
  }

  private async isStaff(userId: string): Promise<boolean> {
    const rows = await this.prisma.userRole.findMany({ where: { userId }, include: { role: true } });
    return rows.some((r) => STAFF_ROLES.includes(r.role.key));
  }

  private async accessible(disputeId: string, userId: string) {
    const dispute = await this.get(disputeId);
    const order = await this.prisma.order.findUnique({ where: { id: dispute.orderId } });
    const staff = await this.isStaff(userId);
    const participant = order?.buyerId === userId || order?.sellerId === userId;
    if (!participant && !staff) throw new ForbiddenException('Нет доступа к спору');
    return { dispute, order, isStaff: staff };
  }
}
