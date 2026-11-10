import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { normalizeCommand } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { ListingsService } from '../listings/listings.service';

/** Больше заготовок в выпадающем списке уже не найти глазами. */
export const MAX_TEMPLATES = 30;

const TEMPLATE = { id: true, title: true, body: true, command: true } as const;

export interface TemplateInput {
  title: string;
  body: string;
  /** Команда, по которой заготовка уходит сама; пусто — только вручную. */
  command?: string | null;
}

/**
 * Инструменты продавца, как у бота FunPayCardinal, только встроенные:
 * заготовки ответов для чата (с командой — автоответ), приветствие
 * покупателю в новом диалоге и автоподнятие лотов. Приветствие и
 * автоответы отправляет чат, автоподнятие — сервис лотов; здесь — настройки.
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

  /**
   * Команда в том виде, в каком её сравнивает чат. Одна команда — одна
   * заготовка: иначе неясно, что отправлять.
   */
  private async command(userId: string, raw: string | null | undefined, selfId?: string) {
    const command = raw ? normalizeCommand(raw) : '';
    if (!command) return null;
    const taken = await this.prisma.replyTemplate.findFirst({
      where: { userId, command, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { title: true },
    });
    if (taken) {
      throw new BadRequestException(`Команда ${command} уже есть у заготовки «${taken.title}»`);
    }
    return command;
  }

  async addTemplate(userId: string, input: TemplateInput) {
    const count = await this.prisma.replyTemplate.count({ where: { userId } });
    if (count >= MAX_TEMPLATES) {
      throw new BadRequestException(`Не больше ${MAX_TEMPLATES} заготовок — удалите ненужные`);
    }
    const command = await this.command(userId, input.command);
    return this.prisma.replyTemplate.create({
      data: { userId, title: input.title, body: input.body, command },
      select: TEMPLATE,
    });
  }

  async updateTemplate(userId: string, id: string, input: TemplateInput) {
    const command = await this.command(userId, input.command, id);
    const r = await this.prisma.replyTemplate.updateMany({
      where: { id, userId },
      data: { title: input.title, body: input.body, command },
    });
    if (!r.count) throw new NotFoundException('Заготовка не найдена');
    return { id, title: input.title, body: input.body, command };
  }

  async removeTemplate(userId: string, id: string) {
    const r = await this.prisma.replyTemplate.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Заготовка не найдена');
    return { ok: true };
  }
}
