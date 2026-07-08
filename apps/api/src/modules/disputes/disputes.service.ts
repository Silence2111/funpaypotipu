import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { OrdersService } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../access/audit.service';
import { StorageService } from '../storage/storage.service';
import { ScanService } from '../antivirus/scan.service';

const STAFF_ROLES = ['agent', 'moderator', 'admin'];

interface DisputeAttachment {
  key: string;
  mime: string;
  size: number;
}

@Injectable()
export class DisputesService {
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
    const dispute = await this.prisma.dispute.create({
      data: { orderId, openedBy: userId, reason, status: 'open' },
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

  /** Арбитр берёт спор в работу (роут под RolesGuard('agent')). */
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

  async getForUser(disputeId: string, userId: string) {
    const { dispute, isStaff } = await this.accessible(disputeId, userId);
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
    return { dispute, messages };
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

  queue() {
    return this.prisma.dispute.findMany({
      where: { status: { in: ['open', 'in_review'] } },
      orderBy: { createdAt: 'asc' },
    });
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
