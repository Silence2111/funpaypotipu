import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@gamemarket/db';
import { maskContacts } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { ScanService } from '../antivirus/scan.service';

export interface ChatAttachmentDto {
  url: string;
  mime: string;
}

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string; // уже замаскированный для показа
  isFlagged: boolean;
  attachments?: ChatAttachmentDto[];
  createdAt: Date;
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly scanner: ScanService,
  ) {}

  /** Presigned PUT для прямой загрузки вложения клиентом. */
  async requestUpload(conversationId: string, userId: string, mime: string) {
    await this.assertParticipant(conversationId, userId);
    if (!this.storage.enabled) throw new NotFoundException('Хранилище недоступно');
    const ext = mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
    const key = `chat/${conversationId}/${randomUUID()}.${ext}`;
    return { key, uploadUrl: await this.storage.presignPut(key) };
  }

  /** Сообщение-вложение (после успешной загрузки по presigned-URL). */
  async sendAttachment(
    conversationId: string,
    senderId: string,
    key: string,
    mime: string,
    size: number,
  ): Promise<ChatMessageDto> {
    const conv = await this.assertParticipant(conversationId, senderId);
    await this.scan(key);
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        type: 'attachment',
        body: '',
        attachments: { create: { url: key, mime, size, scanStatus: 'clean' } },
      },
      include: { attachments: true },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    });
    const recipientId = conv.buyerId === senderId ? conv.sellerId : conv.buyerId;
    await this.notifications.notify(recipientId, 'new_message', { conversationId });

    return {
      id: message.id,
      conversationId,
      senderId,
      body: '',
      isFlagged: false,
      attachments: [{ url: await this.storage.presignGet(key), mime }],
      createdAt: message.createdAt,
    };
  }

  async listConversations(userId: string) {
    const convs = await this.prisma.conversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    });
    if (!convs.length) return [];
    const grouped = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: convs.map((c) => c.id) },
        senderId: { not: userId },
        readAt: null,
      },
      _count: { _all: true },
    });
    const unread = new Map(grouped.map((g) => [g.conversationId, g._count._all]));
    return convs.map((c) => ({ ...c, unread: unread.get(c.id) ?? 0 }));
  }

  /** Отметить входящие сообщения диалога прочитанными. */
  async markRead(conversationId: string, userId: string) {
    await this.assertParticipant(conversationId, userId);
    await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  /** Начать (или открыть существующий) предпродажный диалог с продавцом лота. */
  async startWithSeller(buyerId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { sellerId: true },
    });
    if (!listing) throw new NotFoundException('Лот не найден');
    if (listing.sellerId === buyerId) throw new ForbiddenException('Это ваш лот');

    const existing = await this.prisma.conversation.findFirst({
      where: { buyerId, sellerId: listing.sellerId, orderId: null },
    });
    if (existing) return { id: existing.id };

    const conv = await this.prisma.conversation.create({
      data: { buyerId, sellerId: listing.sellerId },
    });
    return { id: conv.id };
  }

  /** Антивирус-скан вложения через ScanService. Заражённое удаляется из хранилища. */
  private async scan(key: string): Promise<void> {
    if (!this.storage.enabled) return;
    const result = await this.scanner.scan(await this.storage.getBytes(key));
    if (!result.clean) {
      await this.storage.remove(key);
      throw new BadRequestException(`Файл не прошёл антивирус-проверку: ${result.reason}`);
    }
  }

  async assertParticipant(conversationId: string, userId: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Диалог не найден');
    if (conv.buyerId !== userId && conv.sellerId !== userId) {
      throw new ForbiddenException('Нет доступа к диалогу');
    }
    return conv;
  }

  async getMessages(conversationId: string, userId: string, limit = 100): Promise<ChatMessageDto[]> {
    await this.assertParticipant(conversationId, userId);
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: { attachments: true },
    });
    return Promise.all(
      rows.map(async (m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        body: m.bodyMasked ?? m.body,
        isFlagged: m.isFlagged,
        attachments:
          m.attachments.length && this.storage.enabled
            ? await Promise.all(
                m.attachments.map(async (a) => ({
                  url: await this.storage.presignGet(a.url),
                  mime: a.mime,
                })),
              )
            : undefined,
        createdAt: m.createdAt,
      })),
    );
  }

  /** Отправка: маскируем контакты, храним оригинал (для арбитража) и masked (для показа). */
  async sendMessage(
    conversationId: string,
    senderId: string,
    rawBody: string,
  ): Promise<ChatMessageDto> {
    const conv = await this.assertParticipant(conversationId, senderId);
    const { masked, flagged } = maskContacts(rawBody);

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        type: 'text',
        body: rawBody,
        bodyMasked: masked,
        isFlagged: flagged,
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    });

    // Попытка слить контакты → сигнал антифрода (docs/06).
    if (flagged) {
      await this.prisma.riskSignal.create({
        data: { userId: senderId, type: 'contact_leak', score: 10, payload: { conversationId } },
      });
    }

    const recipientId = conv.buyerId === senderId ? conv.sellerId : conv.buyerId;
    await this.notifications.notify(recipientId, 'new_message', { conversationId });

    return {
      id: message.id,
      conversationId,
      senderId,
      body: masked,
      isFlagged: flagged,
      createdAt: message.createdAt,
    };
  }

  /** Системное сообщение о событии сделки в чат заказа (senderId = null). */
  async postSystem(orderId: string, text: string): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { orderId },
      select: { id: true },
    });
    if (!conv) return;
    const message = await this.prisma.message.create({
      data: { conversationId: conv.id, senderId: null, type: 'system', body: text },
    });
    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: message.createdAt },
    });
  }
}
