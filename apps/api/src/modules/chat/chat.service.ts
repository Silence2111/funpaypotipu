import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { maskContacts } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string; // уже замаскированный для показа
  isFlagged: boolean;
  createdAt: Date;
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
  ) {}

  listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    });
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
    });
    return rows.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      body: m.bodyMasked ?? m.body,
      isFlagged: m.isFlagged,
      createdAt: m.createdAt,
    }));
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
}
