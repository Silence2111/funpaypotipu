import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { MailService } from '../mail/mail.service';

/** Тексты писем для e-mail-канала (важные события). */
const EMAIL_SUBJECTS: Record<string, string> = {
  payout_paid: 'Выплата отправлена',
  payout_rejected: 'Заявка на вывод отклонена',
  dispute_opened: 'Открыт спор по вашей сделке',
  dispute_resolved: 'Спор по сделке разрешён',
  review_received: 'Вы получили новый отзыв',
};

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly mail: MailService,
  ) {}

  /** Создать in-app уведомление (+ e-mail для важных типов). */
  async notify(userId: string, type: string, payload: Prisma.InputJsonValue = {}) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, channel: 'in_app', payload },
    });

    const subject = EMAIL_SUBJECTS[type];
    if (subject && this.mail.enabled) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (user?.email) await this.mail.send(user.email, subject, `${subject}. Подробности — в кабинете GameMarket.`);
    }
    return notification;
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
