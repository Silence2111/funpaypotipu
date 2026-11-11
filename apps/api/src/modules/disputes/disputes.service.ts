import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type Dispute, type DisputeStatus } from '@gamemarket/db';
import {
  DISPUTE_APPEAL_HOURS,
  DISPUTE_APPEAL_KEY,
  DISPUTE_APPEAL_MAX_HOURS,
  DISPUTE_NOTES,
  DISPUTE_REMIND_HOURS,
  DISPUTE_RESPONSE_HOURS,
  disputeEvidence,
  BUYER_OPEN_DISPUTES_MAX,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { OrdersService } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../access/audit.service';
import { StorageService } from '../storage/storage.service';
import { ScanService } from '../antivirus/scan.service';
import { likeText } from '../../common/like';
import { nextCursor } from '../../common/cursor';
import { asStaff, staffTwoFactorError } from '../access/staff';

const STAFF_ROLES = ['agent', 'moderator', 'admin'];
const OPEN: DisputeStatus[] = ['open', 'in_review'];
const CLOSED: DisputeStatus[] = ['resolved_buyer', 'resolved_seller', 'cancelled'];

/** Страница очереди арбитра: открытые или решённые, что искать, с какого спора продолжать. */
export interface DisputesQueueQuery {
  state?: 'open' | 'closed';
  q?: string;
  /** Из `next` прошлой страницы; `missed` — у открытых: последний пропустил срок. */
  cursor?: { missed: boolean; at: Date; id: string };
  limit?: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Открытые споры человека упорядочиваются в памяти — больше стольких открытых
 * сразу не бывает и у крупного продавца.
 */
const OPEN_MAX = 1000;

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
    // Защита продавца (часть 136): покупатель держит не больше трёх споров
    // открытыми сразу — споры «на всякий случай» по всем заказам не пройдут.
    const mineOpen = await this.prisma.dispute.count({
      where: { openedBy: userId, status: { in: OPEN }, order: { buyerId: userId } },
    });
    if (mineOpen >= BUYER_OPEN_DISPUTES_MAX) {
      throw new HttpException(
        { statusCode: 429, error: 'dispute_limit', message: `Открыто ${mineOpen} спора — дождитесь решения по ним, потом открывайте новый.` },
        429,
      );
    }

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
    await this.finalizeDue(now);
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
    // Обжалованный спор берёт другой арбитр (часть 135).
    if (dispute.appealedAt && dispute.firstArbiterId === arbiterId) {
      throw new ForbiddenException('Обжалование решает другой арбитр — не тот, кто вынес первое решение');
    }
    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status: 'in_review', arbiterId },
    });
  }

  /**
   * Решение арбитра (часть 135): вступает в силу через окно обжалования —
   * сторона, против которой оно вынесено, может один раз обжаловать (решит
   * другой арбитр) или принять его сразу. Решение по обжалованию и окно 0 ч
   * исполняются сразу. Деньги двигаются через OrdersService.
   */
  async resolve(disputeId: string, arbiterId: string, outcome: 'seller' | 'buyer', note?: string) {
    const dispute = await this.get(disputeId);
    if (dispute.status !== 'in_review' && dispute.status !== 'open') {
      throw new ConflictException('Спор уже разрешён');
    }
    if (dispute.appealedAt && dispute.firstArbiterId === arbiterId) {
      throw new ForbiddenException('Обжалование решает другой арбитр — не тот, кто вынес первое решение');
    }

    const hours = dispute.appealedAt ? 0 : await this.appealHours();
    const now = new Date();
    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: outcome === 'seller' ? 'resolved_seller' : 'resolved_buyer',
        arbiterId,
        resolutionNote: note,
        resolvedAt: now,
        awaitingFrom: null,
        respondBy: null,
        finalizeAt: new Date(now.getTime() + hours * 3_600_000),
      },
    });
    if (hours === 0) {
      await this.execute(updated.id);
    } else {
      await this.note(disputeId, DISPUTE_NOTES.decided);
    }

    await this.audit.log({
      actorId: arbiterId,
      action: `dispute.resolve.${outcome}`,
      entityType: 'dispute',
      entityId: disputeId,
      after: { outcome, orderId: dispute.orderId } as Prisma.InputJsonValue,
    });

    const order = await this.prisma.order.findUnique({ where: { id: dispute.orderId } });
    if (order) {
      const extra = hours ? { finalizeAt: updated.finalizeAt!.toISOString() } : {};
      await this.notifications.notify(order.buyerId, 'dispute_resolved', { disputeId, outcome, ...extra });
      await this.notifications.notify(order.sellerId, 'dispute_resolved', { disputeId, outcome, ...extra });
    }
    return this.get(disputeId);
  }

  /** Окно обжалования, часы: настройка администратора, иначе DISPUTE_APPEAL_HOURS (e2e — 0). */
  async appealHours(): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: DISPUTE_APPEAL_KEY } });
    const saved = (row?.value as { hours?: unknown } | null)?.hours;
    if (typeof saved === 'number' && Number.isInteger(saved) && saved >= 0 && saved <= DISPUTE_APPEAL_MAX_HOURS) return saved;
    const env = Number(process.env.DISPUTE_APPEAL_HOURS ?? DISPUTE_APPEAL_HOURS);
    return Number.isFinite(env) && env >= 0 ? env : DISPUTE_APPEAL_HOURS;
  }

  async setAppealHours(actorId: string, hours: number | null) {
    const before = await this.appealHours();
    if (hours === null) await this.prisma.systemSetting.deleteMany({ where: { key: DISPUTE_APPEAL_KEY } });
    else {
      await this.prisma.systemSetting.upsert({
        where: { key: DISPUTE_APPEAL_KEY },
        create: { key: DISPUTE_APPEAL_KEY, value: { hours } },
        update: { value: { hours } },
      });
    }
    const after = await this.appealHours();
    await this.audit.log({ actorId, action: 'settings.dispute_appeal', entityType: 'setting', entityId: DISPUTE_APPEAL_KEY, before: { hours: before }, after: { hours: after } });
    return { hours: after, saved: hours !== null };
  }

  /**
   * Исполнить решение: деньги по исходу. Занимаем первыми — второй экземпляр
   * не проведёт дважды; заказ уже не в споре (продавец вернул деньги сам) —
   * исполнять нечего. Сбой — решение снова ждёт исполнения.
   */
  private async execute(disputeId: string) {
    const claimed = await this.prisma.dispute.updateMany({
      where: { id: disputeId, executedAt: null, status: { in: ['resolved_buyer', 'resolved_seller'] } },
      data: { executedAt: new Date() },
    });
    if (!claimed.count) return;
    const d = await this.get(disputeId);
    const order = await this.prisma.order.findUnique({ where: { id: d.orderId }, select: { status: true } });
    if (order?.status !== 'disputed') return;
    try {
      await this.orders.applyDisputeResolution(d.orderId, d.status === 'resolved_seller' ? 'seller' : 'buyer');
    } catch (e) {
      await this.prisma.dispute.update({ where: { id: disputeId }, data: { executedAt: null } });
      throw e;
    }
  }

  /** Решение против этой стороны: она может обжаловать или принять. */
  private loserOf(d: Dispute, order: { buyerId: string; sellerId: string }) {
    return d.status === 'resolved_buyer' ? order.sellerId : d.status === 'resolved_seller' ? order.buyerId : null;
  }

  private pending(d: Dispute) {
    return (d.status === 'resolved_buyer' || d.status === 'resolved_seller') && !d.executedAt && !!d.finalizeAt && d.finalizeAt > new Date();
  }

  /**
   * Обжалование (часть 135): одно, сторона, против которой решение, пока
   * оно не вступило в силу. Спор возвращается в очередь — его берёт другой
   * арбитр; первое решение остаётся видно ему.
   */
  async appeal(disputeId: string, userId: string, text: string) {
    const { dispute, order } = await this.accessible(disputeId, userId);
    if (!order) throw new NotFoundException('Заказ не найден');
    if (dispute.appealedAt) throw new ConflictException('Решение по спору обжалуется один раз');
    if (!this.pending(dispute)) throw new ConflictException('Решение уже вступило в силу — обжаловать нельзя');
    if (this.loserOf(dispute, order) !== userId) {
      throw new ForbiddenException('Обжаловать может сторона, против которой вынесено решение');
    }
    const claimed = await this.prisma.dispute.updateMany({
      where: { id: disputeId, appealedAt: null, executedAt: null },
      data: {
        status: 'open',
        appealedBy: userId,
        appealedAt: new Date(),
        appealText: text,
        firstArbiterId: dispute.arbiterId,
        firstOutcome: dispute.status === 'resolved_buyer' ? 'buyer' : 'seller',
        firstNote: dispute.resolutionNote,
        arbiterId: null,
        resolutionNote: null,
        resolvedAt: null,
        finalizeAt: null,
      },
    });
    if (!claimed.count) throw new ConflictException('Решение уже вступило в силу — обжаловать нельзя');
    await this.note(disputeId, DISPUTE_NOTES.appealed);
    await this.audit.log({ actorId: userId, action: 'dispute.appeal', entityType: 'dispute', entityId: disputeId, after: { text } });
    const other = order.buyerId === userId ? order.sellerId : order.buyerId;
    await this.notifications.notify(other, 'dispute_appealed', { disputeId, orderId: order.id });
    return this.get(disputeId);
  }

  /** Сторона, против которой решение, принимает его — исполняется сразу. */
  async accept(disputeId: string, userId: string) {
    const { dispute, order } = await this.accessible(disputeId, userId);
    if (!order) throw new NotFoundException('Заказ не найден');
    if (!this.pending(dispute)) throw new ConflictException('Решение уже вступило в силу');
    if (this.loserOf(dispute, order) !== userId) {
      throw new ForbiddenException('Принять решение может сторона, против которой оно вынесено');
    }
    await this.prisma.dispute.update({ where: { id: disputeId }, data: { finalizeAt: new Date() } });
    await this.execute(disputeId);
    await this.note(disputeId, DISPUTE_NOTES.accepted);
    return this.get(disputeId);
  }

  /** Окно обжалования прошло — решение исполняется (из прохода по срокам). */
  private async finalizeDue(now: Date) {
    const due = await this.prisma.dispute.findMany({
      where: { status: { in: ['resolved_buyer', 'resolved_seller'] }, executedAt: null, finalizeAt: { lte: now } },
      select: { id: true },
      take: 100,
    });
    for (const d of due) {
      try {
        await this.execute(d.id);
        await this.note(d.id, DISPUTE_NOTES.executed);
      } catch (e) {
        this.logger.warn(`Исполнение решения по спору ${d.id}: ${(e as Error).message}`);
      }
    }
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
    const names = await this.usernames([order?.buyerId, order?.sellerId, dispute.arbiterId, dispute.firstArbiterId]);
    // Решает спор арбитр или администратор; модератор видит переписку, но денег не двигает.
    // Обжалованный — не тот, кто вынес первое решение (часть 135).
    const canResolve =
      isStaff &&
      !(dispute.appealedAt && dispute.firstArbiterId === userId) &&
      (await this.prisma.userRole.count({ where: { userId, role: { key: { in: ['agent', 'admin'] } } } })) > 0;
    const side = order?.buyerId === userId ? 'buyer' : order?.sellerId === userId ? 'seller' : null;
    const loser = order ? this.loserOf(dispute, order) : null;
    const segment = order
      ? (await this.prisma.listing.findUnique({ where: { id: order.listingId }, select: { category: { select: { segment: true } } } }))?.category.segment ?? null
      : null;
    return {
      dispute,
      messages,
      isStaff,
      canResolve,
      // Решение ждёт вступления в силу: проигравшая сторона — обжаловать (один раз) или принять.
      canAppeal: !!loser && loser === userId && !dispute.appealedAt && this.pending(dispute),
      canAccept: !!loser && loser === userId && this.pending(dispute),
      firstArbiter: dispute.firstArbiterId ? { id: dispute.firstArbiterId, username: names.get(dispute.firstArbiterId) ?? null } : null,
      // Что приложить — по типу товара: стороне — своё, арбитру — обеим.
      evidence: side
        ? { [side]: disputeEvidence(segment, side) }
        : { buyer: disputeEvidence(segment, 'buyer'), seller: disputeEvidence(segment, 'seller') },
      // Журнал выдачи — площадка прикладывает сама (часть 135).
      journal: order ? await this.journal(order) : [],
      // Сторона спора: покупателю — «претензий нет», продавцу — «вернуть деньги».
      side,
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

  /**
   * Журнал выдачи: оплата, «взял в работу», выдача (сам или автоматически),
   * когда покупатель впервые открыл товар и сколько раз, сообщения продавца
   * в чате заказа, подтверждение и гарантия. Из базы, не со слов сторон.
   */
  private async journal(order: {
    id: string; sellerId: string; paidAt: Date | null; deliveredAt: Date | null; completedAt: Date | null;
    fulfillmentType: string; serviceStartedAt?: Date | null; serviceDueAt?: Date | null; warrantyUntil?: Date | null;
    receivedAt?: Date | null;
  }) {
    const [delivery, sellerMsgs] = await Promise.all([
      this.prisma.delivery.findUnique({ where: { orderId: order.id }, select: { firstViewedAt: true, viewCount: true } }),
      order.paidAt
        ? this.prisma.message.findMany({
            where: { conversation: { orderId: order.id }, senderId: order.sellerId, createdAt: { gte: order.paidAt } },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          })
        : [],
    ]);
    const events: Array<{ at: Date; code: string; count?: number }> = [];
    if (order.paidAt) events.push({ at: order.paidAt, code: 'paid' });
    if (order.serviceStartedAt) events.push({ at: order.serviceStartedAt, code: 'service_started' });
    if (sellerMsgs.length) events.push({ at: sellerMsgs[0]!.createdAt, code: 'seller_messages', count: sellerMsgs.length });
    if (order.deliveredAt) events.push({ at: order.deliveredAt, code: order.fulfillmentType === 'manual' ? 'delivered_manual' : 'delivered_auto' });
    if (delivery?.firstViewedAt) events.push({ at: delivery.firstViewedAt, code: 'first_view', count: delivery.viewCount });
    if (order.receivedAt) events.push({ at: order.receivedAt, code: 'received' });
    if (order.completedAt) events.push({ at: order.completedAt, code: 'confirmed' });
    if (order.serviceDueAt) events.push({ at: order.serviceDueAt, code: 'service_due' });
    if (order.warrantyUntil) events.push({ at: order.warrantyUntil, code: 'warranty_until' });
    return events.sort((a, b) => a.at.getTime() - b.at.getTime());
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
   * где ход за ним, с ближайшим сроком; закрытые — по времени решения, свежие
   * сверху. По `limit` (30) за раз, дальше — с `before`: id последнего
   * показанного спора. Рядом — сколько открытых, закрытых и ждущих его
   * ответа, для вкладок.
   */
  async mine(
    userId: string,
    state: 'open' | 'closed' = 'open',
    q: { before?: string; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(Math.trunc(q.limit ?? 30) || 30, 1), 100);
    const mine: Prisma.DisputeWhereInput = {
      order: { OR: [{ buyerId: userId }, { sellerId: userId }] },
    };
    const last = q.before
      ? UUID.test(q.before)
        ? await this.prisma.dispute.findFirst({
            where: { id: q.before, ...mine },
            select: {
              id: true,
              status: true,
              awaitingFrom: true,
              respondBy: true,
              createdAt: true,
              resolvedAt: true,
              order: { select: { buyerId: true } },
            },
          })
        : null
      : undefined;
    if (last === null) throw new BadRequestException('Список споров устарел — обновите страницу');

    let ids: string[];
    let more: boolean;
    if (state === 'open') {
      // «Ход за мной» запросом не выразить: порядок — по всем открытым в
      // памяти, страница — всё, что в этом порядке после последнего показанного.
      // Порядок считается по текущим данным, поэтому и закрывшийся за это
      // время спор-курсор находит своё место.
      type Key = [number, number, number, string];
      const keyOf = (d: NonNullable<typeof last>): Key => {
        const side: Side = d.order.buyerId === userId ? 'buyer' : 'seller';
        const turn = OPEN.includes(d.status) && d.awaitingFrom === side;
        return [turn ? 0 : 1, d.respondBy?.getTime() ?? Infinity, -d.createdAt.getTime(), d.id];
      };
      const cmp = (a: Key, b: Key) =>
        (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0);
      const all = await this.prisma.dispute.findMany({
        where: { ...mine, status: { in: OPEN } },
        select: {
          id: true,
          status: true,
          awaitingFrom: true,
          respondBy: true,
          createdAt: true,
          resolvedAt: true,
          order: { select: { buyerId: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: OPEN_MAX,
      });
      const sorted = all.map((d) => ({ id: d.id, key: keyOf(d) })).sort((a, b) => cmp(a.key, b.key));
      const after = last ? sorted.filter((d) => cmp(d.key, keyOf(last)) > 0) : sorted;
      ids = after.slice(0, limit).map((d) => d.id);
      more = after.length > limit;
    } else {
      // Решённые без даты решения (такого не бывает, но поле необязательное) — в конце.
      const after: Prisma.DisputeWhereInput = !last
        ? {}
        : last.resolvedAt
          ? {
              OR: [
                { resolvedAt: { lt: last.resolvedAt } },
                { resolvedAt: last.resolvedAt, id: { lt: last.id } },
                { resolvedAt: null },
              ],
            }
          : { resolvedAt: null, id: { lt: last.id } };
      const rows = await this.prisma.dispute.findMany({
        where: { ...mine, status: { notIn: OPEN }, ...after },
        orderBy: [{ resolvedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        take: limit + 1,
        select: { id: true },
      });
      ids = rows.slice(0, limit).map((d) => d.id);
      more = rows.length > limit;
    }

    const [found, open, closed, myTurn] = await Promise.all([
      this.prisma.dispute.findMany({
        where: { id: { in: ids } },
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
    const byId = new Map(found.map((d) => [d.id, d]));
    const rows = ids.map((id) => byId.get(id)).filter((d): d is (typeof found)[number] => !!d);
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
    return {
      items,
      counts: { open, closed, myTurn },
      next: more && ids.length ? ids.at(-1)! : null,
    };
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

  /**
   * Очередь арбитра: сумма, стороны, кто взял, чей ход. Открытые — кто
   * пропустил срок ответа, сверху (такой спор можно решать по тому, что
   * есть), дальше от старых к новым; решённые — свежие решения сверху. По
   * страницам, со счётчиками; поиск — по номеру заказа, лоту из заказа и
   * никам сторон. Раньше открытые грузились все разом, а решённых в консоли
   * не было вовсе: найти, чем кончился спор, было негде.
   */
  async queue(q: DisputesQueueQuery = {}) {
    const closed = q.state === 'closed';
    const limit = q.limit ?? 50;
    const text = q.q?.trim().replace(/^[#@]+/, '');
    const pattern = `%${likeText(text ?? '')}%`;
    // Споров меньше, чем заказов: для каждого спора заказ — по ключу, ники —
    // одним подзапросом по триграммам профилей.
    const match = text
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM orders o WHERE o.id = d.order_id AND (
          o.public_number ILIKE ${pattern} OR (o.listing_snapshot ->> 'title') ILIKE ${pattern}
          OR o.buyer_id IN (SELECT p.user_id FROM profiles p WHERE p.username ILIKE ${pattern})
          OR o.seller_id IN (SELECT p.user_id FROM profiles p WHERE p.username ILIKE ${pattern})))`
      : Prisma.empty;
    const c = q.cursor;
    // Время в базе — UTC без пояса.
    const at = c ? Prisma.sql`(${c.at.toISOString()}::timestamptz AT TIME ZONE 'UTC')` : Prisma.empty;
    const page = await this.prisma.$queryRaw<Array<{ id: string; missed: boolean; at: Date }>>(
      closed
        ? Prisma.sql`
            SELECT d.id, FALSE AS missed, d.resolved_at AS at FROM disputes d
            WHERE d.status::text = ANY(${CLOSED}::text[]) ${match}
              ${c ? Prisma.sql`AND (d.resolved_at, d.id) < (${at}, ${c.id}::uuid)` : Prisma.empty}
            ORDER BY d.resolved_at DESC NULLS LAST, d.id DESC LIMIT ${limit + 1}`
        : Prisma.sql`
            SELECT d.id, d.missed_by IS NOT NULL AS missed, d.created_at AS at FROM disputes d
            WHERE d.status::text = ANY(${OPEN}::text[]) ${match}
              ${c ? Prisma.sql`AND (d.missed_by IS NULL, d.created_at, d.id) > (${!c.missed}, ${at}, ${c.id}::uuid)` : Prisma.empty}
            ORDER BY d.missed_by IS NULL, d.created_at, d.id LIMIT ${limit + 1}`,
    );
    const [counted] = await this.prisma.$queryRaw<Array<{ open: number; missed: number; closed: number }>>`
      SELECT count(*) FILTER (WHERE d.status::text = ANY(${OPEN}::text[]))::int AS open,
             count(*) FILTER (WHERE d.status::text = ANY(${OPEN}::text[]) AND d.missed_by IS NOT NULL)::int AS missed,
             count(*) FILTER (WHERE d.status::text = ANY(${CLOSED}::text[]))::int AS closed
      FROM disputes d WHERE TRUE ${match}`;
    const ids = page.slice(0, limit).map((r) => r.id);
    const place = new Map(ids.map((id, i) => [id, i]));
    const disputes = (
      await this.prisma.dispute.findMany({
        where: { id: { in: ids } },
        include: {
          order: {
            select: { publicNumber: true, amount: true, currency: true, buyerId: true, sellerId: true, listingSnapshot: true },
          },
          _count: { select: { messages: true } },
        },
      })
    ).sort((a, b) => place.get(a.id)! - place.get(b.id)!);
    const names = await this.usernames(
      disputes.flatMap((d) => [d.order?.buyerId, d.order?.sellerId, d.arbiterId]),
    );
    const items = disputes.map(({ order, _count, ...d }) => ({
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
    const last = page[ids.length - 1];
    // Курсор открытых помнит, пропустил ли последний спор срок: эти идут первыми.
    const next =
      page.length > limit && last ? `${last.missed ? 'm' : 'w'}${nextCursor(last.at, last.id)}` : null;
    return { items, next, counts: counted ?? { open: 0, missed: 0, closed: 0 } };
  }

  private async get(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Спор не найден');
    return dispute;
  }

  /**
   * Чужой спор открывает только сотрудник с входом с кодом (часть 119).
   * Участник сделки с ролью, но без кода, — действует как участник.
   */
  private async accessible(disputeId: string, userId: string) {
    const dispute = await this.get(disputeId);
    const order = await this.prisma.order.findUnique({ where: { id: dispute.orderId } });
    const { staff, needsTwoFactor } = await asStaff(this.prisma, userId, STAFF_ROLES);
    const participant = order?.buyerId === userId || order?.sellerId === userId;
    if (!participant && !staff) {
      if (needsTwoFactor) throw staffTwoFactorError();
      throw new ForbiddenException('Нет доступа к спору');
    }
    return { dispute, order, isStaff: staff };
  }
}
