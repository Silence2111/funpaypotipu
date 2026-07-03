import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

@Injectable()
export class NotificationsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Создать in-app уведомление. Вызывается другими сервисами. */
  notify(userId: string, type: string, payload: Prisma.InputJsonValue = {}) {
    return this.prisma.notification.create({
      data: { userId, type, channel: 'in_app', payload },
    });
  }

  listMine(userId: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async markRead(id: string, userId: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
