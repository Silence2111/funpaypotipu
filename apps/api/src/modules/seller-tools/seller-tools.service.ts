import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { ListingsService } from '../listings/listings.service';

/** Больше заготовок в выпадающем списке уже не найти глазами. */
export const MAX_TEMPLATES = 30;

const TEMPLATE = { id: true, title: true, body: true } as const;

/**
 * Инструменты продавца, как у бота FunPayCardinal, только встроенные:
 * заготовки ответов для чата, приветствие покупателю в новом диалоге и
 * автоподнятие лотов. Само приветствие отправляет чат, автоподнятие —
 * сервис лотов; здесь — настройки.
 */
@Injectable()
export class SellerToolsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly listings: ListingsService,
  ) {}

  async get(userId: string) {
    const [profile, templates, raise] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { userId },
        select: { greetingText: true, autoRaise: true },
      }),
      this.templates(userId),
      this.listings.raiseStatus(userId),
    ]);
    return {
      greeting: profile?.greetingText ?? null,
      autoRaise: profile?.autoRaise ?? false,
      raise,
      templates,
    };
  }

  /** Пустое приветствие — выключено. */
  async setGreeting(userId: string, text: string | null) {
    const greeting = text?.trim() || null;
    await this.prisma.profile.update({ where: { userId }, data: { greetingText: greeting } });
    return { greeting };
  }

  async setAutoRaise(userId: string, on: boolean) {
    await this.prisma.profile.update({ where: { userId }, data: { autoRaise: on } });
    return { autoRaise: on, raise: await this.listings.raiseStatus(userId) };
  }

  templates(userId: string) {
    return this.prisma.replyTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: TEMPLATE,
    });
  }

  async addTemplate(userId: string, title: string, body: string) {
    const count = await this.prisma.replyTemplate.count({ where: { userId } });
    if (count >= MAX_TEMPLATES) {
      throw new BadRequestException(`Не больше ${MAX_TEMPLATES} заготовок — удалите ненужные`);
    }
    return this.prisma.replyTemplate.create({ data: { userId, title, body }, select: TEMPLATE });
  }

  async updateTemplate(userId: string, id: string, title: string, body: string) {
    const r = await this.prisma.replyTemplate.updateMany({
      where: { id, userId },
      data: { title, body },
    });
    if (!r.count) throw new NotFoundException('Заготовка не найдена');
    return { id, title, body };
  }

  async removeTemplate(userId: string, id: string) {
    const r = await this.prisma.replyTemplate.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Заготовка не найдена');
    return { ok: true };
  }
}
