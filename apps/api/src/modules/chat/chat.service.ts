import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@gamemarket/db';
import {
  COMMAND_MAX,
  addReplySample,
  fillTemplate,
  maskContacts,
  maskContactsExcept,
  normalizeCommand,
  replyTime,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { ScanService } from '../antivirus/scan.service';
import { BlocksService } from '../access/blocks.service';
import { assetUrl } from '../storage/asset-url';
import { likeText } from '../../common/like';

/** Страница списка диалогов: сколько, от какого диалога дальше и что искать. */
export interface ConversationsQuery {
  limit?: number;
  /** Время и id последнего показанного диалога — «Показать ещё» продолжает с него. */
  before?: Date;
  beforeId?: string;
  /** Часть ника собеседника, номера или названия заказа. */
  q?: string;
}

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
  /** Когда собеседник прочитал; null — ещё нет. */
  readAt?: Date | null;
  /** Автоответ продавца (приветствие, ответ на команду) — сайт подписывает его. */
  auto?: boolean;
}

/** Новое сообщение: в комнату диалога и в личные комнаты участников (список диалогов). */
type Publish = (conversationId: string, message: ChatMessageDto, participants: string[]) => void;
/** Собеседник прочитал диалог: у отправителя сообщения становятся «прочитано». */
type PublishRead = (conversationId: string, readerId: string, at: Date) => void;

/** Превью сообщения в списке диалогов: замаскированный текст, у вложения — слово. */
const previewOf = (m: { type: string; body: string; bodyMasked: string | null }) => {
  const text = m.type === 'attachment' ? 'Вложение' : (m.bodyMasked ?? m.body);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
};

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  /**
   * Доставка нового сообщения в открытые чаты. Её подключает шлюз сокетов
   * (ChatGateway.afterInit): сервис не знает о транспорте. Раньше в комнату
   * уходили только сообщения, отправленные через сокет, — системные («Оплата
   * поступила», «Продавец вернул деньги») и отправленные через REST
   * появлялись у собеседника только после перезагрузки.
   */
  private publish: Publish = () => {};
  private publishRead: PublishRead = () => {};

  setPublisher(fn: Publish) {
    this.publish = fn;
  }

  setReadPublisher(fn: PublishRead) {
    this.publishRead = fn;
  }

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly scanner: ScanService,
    private readonly blocks: BlocksService,
  ) {}

  /**
   * Чёрный список закрывает переписку до сделки. Диалог оплаченного заказа
   * остаётся открытым: без него товар не передать и спор не разобрать.
   */
  private async assertNotBlocked(conv: { orderId: string | null; buyerId: string; sellerId: string }, senderId: string) {
    if (conv.orderId) return;
    await this.blocks.assertCanContact(senderId, conv.buyerId === senderId ? conv.sellerId : conv.buyerId, 'message');
  }

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
    await this.assertNotBlocked(conv, senderId);
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
    await this.notifications.notify(recipientId, 'new_message', {
      conversationId,
      preview: 'Вложение',
      from: await this.nameOf(senderId),
    });

    const dto: ChatMessageDto = {
      id: message.id,
      conversationId,
      senderId,
      body: '',
      isFlagged: false,
      attachments: [{ url: await this.storage.presignGet(key), mime }],
      createdAt: message.createdAt,
      readAt: null,
    };
    this.publish(conversationId, dto, [conv.buyerId, conv.sellerId]);
    if (senderId === conv.sellerId) await this.noteReply(conv, message.createdAt);
    return dto;
  }

  /**
   * Список диалогов для мессенджера, как у FunPay: собеседник и в сети ли он,
   * последнее сообщение, непрочитанные, заказ, если диалог по сделке. Раньше
   * список отдавал голые строки диалогов, и сайт писал «Диалог по сделке» без
   * имени собеседника и текста.
   *
   * Свежие сверху — по времени, которое список и показывает: последнее
   * сообщение, у пустого диалога — создание. Раньше отдавались 200 последних
   * и всё: у продавца с тысячами заказов старые переписки было не открыть, а
   * поиск на сайте перебирал только загруженные. Теперь — страница и
   * «Показать ещё» от последнего показанного, а ищет база.
   */
  async listConversations(userId: string, q: ConversationsQuery = {}) {
    const ids = await this.pageIds(userId, q);
    if (!ids.length) return [];
    const place = new Map(ids.map((id, i) => [id, i]));
    const rows = await this.describe(userId, { id: { in: ids } });
    return rows.sort((a, b) => place.get(a.id)! - place.get(b.id)!);
  }

  /**
   * Id диалогов страницы. Своя ветка на каждую сторону (я продаю / я
   * покупаю), а в поиске — ещё и на каждое поле: ник через триграммы
   * профилей, номер и название — через триграммы заказов той же стороны
   * (миграция `orders_search_trgm`). Одним условием с «или» база соединяла
   * все диалоги продавца с заказами и профилями: на 20 тыс. диалогов — 25 мс
   * на поиск, ветками — 1,5–15.
   */
  private async pageIds(userId: string, q: ConversationsQuery): Promise<string[]> {
    const take = q.limit ?? 200;
    const at = Prisma.sql`COALESCE(c.last_message_at, c.created_at)`;
    // Время в базе — UTC без пояса; пояс соединения на сравнение не влияет.
    const after =
      q.before && q.beforeId
        ? Prisma.sql`AND (${at}, c.id) < (${q.before.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${q.beforeId}::uuid)`
        : Prisma.empty;
    const text = q.q?.trim();
    const pattern = text ? `%${likeText(text)}%` : '';
    const sides = [
      { mine: Prisma.sql`c.seller_id`, other: Prisma.sql`c.buyer_id`, orderSide: Prisma.sql`o.seller_id` },
      { mine: Prisma.sql`c.buyer_id`, other: Prisma.sql`c.seller_id`, orderSide: Prisma.sql`o.buyer_id` },
    ];
    const branches = sides.flatMap(({ mine, other, orderSide }) => {
      const where = Prisma.sql`WHERE ${mine} = ${userId}::uuid ${after}`;
      if (!text) return [Prisma.sql`FROM conversations c ${where}`];
      const withOrder = Prisma.sql`FROM conversations c JOIN orders o ON o.id = c.order_id ${where} AND ${orderSide} = ${userId}::uuid`;
      return [
        Prisma.sql`FROM conversations c JOIN profiles p ON p.user_id = ${other} ${where} AND p.username ILIKE ${pattern}`,
        Prisma.sql`${withOrder} AND o.public_number ILIKE ${pattern}`,
        Prisma.sql`${withOrder} AND (o.listing_snapshot ->> 'title') ILIKE ${pattern}`,
      ];
    });
    const query = Prisma.sql`
      SELECT id FROM (${Prisma.join(
        branches.map((from) => Prisma.sql`(SELECT c.id, ${at} AS sort_at ${from} ORDER BY ${at} DESC, c.id DESC LIMIT ${take})`),
        ' UNION ',
      )}) t
      ORDER BY sort_at DESC, id DESC LIMIT ${take}`;
    if (!text) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(query);
      return rows.map((r) => r.id);
    }
    // Какой индекс выгоднее, решает текст поиска, а общий план
    // подготовленного запроса его не видит — как в поиске по заказам.
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('plan_cache_mode', 'force_custom_plan', true)`;
      return tx.$queryRaw<Array<{ id: string }>>(query);
    });
    return rows.map((r) => r.id);
  }

  /** Один диалог для шапки мессенджера: собеседник и заказ — без загрузки всего списка. */
  async getConversation(conversationId: string, userId: string) {
    await this.assertParticipant(conversationId, userId);
    const [conv] = await this.describe(userId, { id: conversationId });
    if (!conv) throw new NotFoundException('Диалог не найден');
    return conv;
  }

  private async describe(userId: string, where: Prisma.ConversationWhereInput) {
    const convs = await this.prisma.conversation.findMany({
      where: { ...where, OR: [{ buyerId: userId }, { sellerId: userId }] },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        orderId: true,
        buyerId: true,
        sellerId: true,
        lastMessageAt: true,
        createdAt: true,
        order: { select: { publicNumber: true, status: true, listingSnapshot: true } },
      },
    });
    if (!convs.length) return [];
    const ids = convs.map((c) => c.id);
    const others = [...new Set(convs.map((c) => (c.buyerId === userId ? c.sellerId : c.buyerId)))];
    const [grouped, lastRows, profiles] = await Promise.all([
      this.prisma.message.groupBy({
        by: ['conversationId'],
        where: { conversationId: { in: ids }, senderId: { not: userId }, readAt: null },
        _count: { _all: true },
      }),
      // Последнее сообщение каждого диалога одним запросом.
      this.prisma.$queryRaw<
        Array<{ conversation_id: string; sender_id: string | null; type: string; body: string; body_masked: string | null; created_at: Date }>
      >`SELECT DISTINCT ON (conversation_id) conversation_id, sender_id, type::text AS type, body, body_masked, created_at
        FROM messages WHERE conversation_id = ANY(${ids}::uuid[])
        ORDER BY conversation_id, created_at DESC`,
      this.prisma.profile.findMany({
        where: { userId: { in: others } },
        select: { userId: true, username: true, avatarUrl: true, onlineAt: true, replySamples: true },
      }),
    ]);
    const unread = new Map(grouped.map((g) => [g.conversationId, g._count._all]));
    const last = new Map(lastRows.map((r) => [r.conversation_id, r]));
    const people = new Map(profiles.map((p) => [p.userId, p]));
    return convs.map((c) => {
      const otherId = c.buyerId === userId ? c.sellerId : c.buyerId;
      const p = people.get(otherId);
      const m = last.get(c.id);
      const snapshot = (c.order?.listingSnapshot ?? {}) as { title?: string };
      return {
        id: c.id,
        orderId: c.orderId,
        lastMessageAt: c.lastMessageAt ?? c.createdAt,
        role: c.buyerId === userId ? ('buyer' as const) : ('seller' as const),
        unread: unread.get(c.id) ?? 0,
        counterpart: {
          id: otherId,
          username: p?.username ?? 'пользователь',
          avatarUrl: assetUrl(p?.avatarUrl),
          onlineAt: p?.onlineAt ?? null,
          // Покупателю — за сколько обычно отвечает продавец.
          replyTime: c.buyerId === userId ? replyTime(p?.replySamples) : null,
        },
        order: c.order
          ? { publicNumber: c.order.publicNumber, status: c.order.status, title: snapshot.title ?? 'Заказ' }
          : null,
        last: m
          ? {
              senderId: m.sender_id,
              system: m.sender_id === null,
              text: previewOf({ type: m.type, body: m.body, bodyMasked: m.body_masked }),
              createdAt: m.created_at,
            }
          : null,
      };
    });
  }

  /** Отметить входящие сообщения диалога прочитанными. */
  async markRead(conversationId: string, userId: string) {
    await this.assertParticipant(conversationId, userId);
    const at = new Date();
    const res = await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: at },
    });
    if (res.count > 0) this.publishRead(conversationId, userId, at);
    return { ok: true };
  }

  /**
   * Уже начатый предпродажный диалог с продавцом лота — без создания нового —
   * и сколько в нём непрочитанных ответов. Чат на странице лота показывает
   * историю, а пустой диалог появляется у продавца только с первым
   * сообщением покупателя.
   */
  async findWithSeller(buyerId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { sellerId: true },
    });
    if (!listing) throw new NotFoundException('Лот не найден');
    const existing = await this.prisma.conversation.findFirst({
      where: { buyerId, sellerId: listing.sellerId, orderId: null },
      select: { id: true },
    });
    if (!existing) return { id: null, unread: 0 };
    const unread = await this.prisma.message.count({
      where: { conversationId: existing.id, senderId: { not: buyerId }, readAt: null },
    });
    return { id: existing.id, unread };
  }

  /**
   * Начать (или открыть существующий) предпродажный диалог с продавцом лота.
   * С текстом — сразу и написать: перед вопросом встаёт строка «Вопрос о
   * лоте …», чтобы продавец с десятком лотов понял, о чём речь. Пока
   * покупатель пишет о том же лоте, строка не повторяется.
   */
  async startWithSeller(buyerId: string, listingId: string, body?: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { sellerId: true, title: true },
    });
    if (!listing) throw new NotFoundException('Лот не найден');
    if (listing.sellerId === buyerId) throw new ForbiddenException('Это ваш лот');
    await this.blocks.assertCanContact(buyerId, listing.sellerId, 'message');

    const conv =
      (await this.prisma.conversation.findFirst({
        where: { buyerId, sellerId: listing.sellerId, orderId: null },
        select: { id: true, buyerId: true, sellerId: true },
      })) ??
      (await this.prisma.conversation.create({
        data: { buyerId, sellerId: listing.sellerId },
        select: { id: true, buyerId: true, sellerId: true },
      }));
    if (!body) return { id: conv.id };

    const messages: ChatMessageDto[] = [];
    const context = `Вопрос о лоте «${listing.title}»`;
    const lastSystem = await this.prisma.message.findFirst({
      where: { conversationId: conv.id, senderId: null },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    });
    if (lastSystem?.body !== context) messages.push(await this.system(conv, context));
    messages.push(await this.sendMessage(conv.id, buyerId, body));
    return { id: conv.id, messages };
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

  /**
   * Последние сообщения диалога (или те, что раньше `before`) — по порядку.
   * Раньше брались первые сто: в долгой переписке свежие сообщения не
   * доходили до экрана вовсе.
   */
  async getMessages(
    conversationId: string,
    userId: string,
    opts: { before?: Date; limit?: number } = {},
  ): Promise<ChatMessageDto[]> {
    await this.assertParticipant(conversationId, userId);
    const rows = await this.prisma.message.findMany({
      where: { conversationId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 100,
      include: { attachments: true },
    });
    rows.reverse();
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
        readAt: m.readAt,
        auto: m.auto,
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
    await this.assertNotBlocked(conv, senderId);
    const { masked, flagged } = await this.mask(conv, rawBody);

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
    // Превью — замаскированный текст: в Telegram и пушах контакты не утекают тоже.
    const preview = masked.length > 140 ? `${masked.slice(0, 140)}…` : masked;
    // Продавцу с заготовками в Telegram — ещё и «Заготовки».
    const templates =
      recipientId === conv.sellerId &&
      (await this.prisma.replyTemplate.count({ where: { userId: recipientId } })) > 0;
    await this.notifications.notify(recipientId, 'new_message', {
      conversationId,
      preview,
      from: await this.nameOf(senderId),
      ...(templates ? { templates: true } : {}),
    });

    const dto: ChatMessageDto = {
      id: message.id,
      conversationId,
      senderId,
      body: masked,
      isFlagged: flagged,
      createdAt: message.createdAt,
      readAt: null,
    };
    this.publish(conversationId, dto, [conv.buyerId, conv.sellerId]);
    if (senderId === conv.buyerId) {
      if (!conv.orderId) await this.greet(conv, message.id);
      await this.answerCommand(conv, rawBody);
    } else if (senderId === conv.sellerId) {
      await this.noteReply(conv, message.createdAt);
    }
    return dto;
  }

  /**
   * Живой ответ продавца — замер для «обычно отвечает за …»: сколько ждало
   * первое сообщение покупателя после прошлого ответа продавца. Автоответы
   * ответом не считаются; покупатель ничего не спрашивал — замера нет.
   * Сбой замера сообщение не роняет: оно уже доставлено.
   */
  private async noteReply(conv: { id: string; buyerId: string; sellerId: string }, at: Date) {
    try {
      const before = await this.prisma.message.findFirst({
        where: { conversationId: conv.id, senderId: conv.sellerId, auto: false, createdAt: { lt: at } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const asked = await this.prisma.message.findFirst({
        where: {
          conversationId: conv.id,
          senderId: conv.buyerId,
          createdAt: { gt: before?.createdAt ?? new Date(0), lt: at },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      if (!asked) return;
      const profile = await this.prisma.profile.findUnique({
        where: { userId: conv.sellerId },
        select: { replySamples: true },
      });
      if (!profile) return;
      const waited = (at.getTime() - asked.createdAt.getTime()) / 1000;
      await this.prisma.profile.update({
        where: { userId: conv.sellerId },
        data: { replySamples: addReplySample(profile.replySamples, at, waited) },
      });
    } catch (e) {
      this.logger.warn(`Время ответа не записано: ${(e as Error).message}`);
    }
  }

  /**
   * Автоответ на команду, как у бота FunPayCardinal: покупатель написал
   * ровно команду заготовки («!оплата») — заготовка уходит от продавца с
   * пометкой «автоответ», в любом диалоге с ним, до сделки и в заказе. Ник
   * покупателя подставляется, как при вставке заготовки вручную. Та же
   * команда ещё раз в течение минуты ответа не дублирует.
   */
  private async answerCommand(conv: { id: string; buyerId: string; sellerId: string }, rawBody: string) {
    const command = normalizeCommand(rawBody);
    if (!command || command.length > COMMAND_MAX) return;
    const template = await this.prisma.replyTemplate.findFirst({
      where: { userId: conv.sellerId, command },
      select: { body: true },
    });
    if (!template) return;
    const name = await this.nameOf(conv.buyerId);
    const text = fillTemplate(template.body, name);
    const last = await this.prisma.message.findFirst({
      where: { conversationId: conv.id, senderId: conv.sellerId },
      orderBy: { createdAt: 'desc' },
      select: { body: true, auto: true, createdAt: true },
    });
    if (last?.auto && last.body === text && Date.now() - last.createdAt.getTime() < 60_000) return;
    await this.postAuto(conv, text);
  }

  /**
   * Скрытие контактов, не трогая ники участников диалога: заготовка с {имя}
   * вставляет ник покупателя, и «stb73721881» скрывался как телефон, а
   * продавцу писался сигнал о сливе контактов.
   */
  private async mask(conv: { buyerId: string; sellerId: string }, text: string) {
    const people = await this.prisma.profile.findMany({
      where: { userId: { in: [conv.buyerId, conv.sellerId] } },
      select: { username: true },
    });
    return maskContactsExcept(text, people.map((p) => p.username));
  }

  /**
   * Приветствие продавца — автоответ на первое сообщение покупателя в новом
   * диалоге до сделки, как у бота FunPayCardinal. Один раз: если в диалоге
   * уже писали, молчит. Подписано «автоответ», чтобы покупатель не принял его
   * за живой ответ; уведомление не уходит — покупатель и так в чате.
   */
  private async greet(conv: { id: string; buyerId: string; sellerId: string }, firstId: string) {
    const seller = await this.prisma.profile.findUnique({
      where: { userId: conv.sellerId },
      select: { greetingText: true },
    });
    if (!seller?.greetingText) return;
    const earlier = await this.prisma.message.count({
      where: { conversationId: conv.id, senderId: { not: null }, id: { not: firstId } },
    });
    if (earlier) return;
    await this.postAuto(conv, seller.greetingText);
  }

  /** Сообщение от продавца без его участия, с пометкой «автоответ». */
  private async postAuto(conv: { id: string; buyerId: string; sellerId: string }, text: string) {
    const { masked, flagged } = await this.mask(conv, text);
    const message = await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        senderId: conv.sellerId,
        type: 'text',
        body: text,
        bodyMasked: masked,
        isFlagged: flagged,
        auto: true,
      },
    });
    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: message.createdAt },
    });
    this.publish(
      conv.id,
      {
        id: message.id,
        conversationId: conv.id,
        senderId: conv.sellerId,
        body: masked,
        isFlagged: flagged,
        createdAt: message.createdAt,
        readAt: null,
        auto: true,
      },
      [conv.buyerId, conv.sellerId],
    );
  }

  /**
   * Сообщение продавца в чат заказа без его участия — текст из лота сразу
   * после оплаты. От его имени, а не от площадки: инструкцию пишет он.
   * Контакты скрыты, как в любом его сообщении.
   */
  async postFromSeller(orderId: string, text: string): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { orderId },
      select: { id: true, buyerId: true, sellerId: true },
    });
    if (!conv) return;
    const { masked, flagged } = maskContacts(text);
    const message = await this.prisma.message.create({
      data: {
        conversationId: conv.id,
        senderId: conv.sellerId,
        type: 'text',
        body: text,
        bodyMasked: masked,
        isFlagged: flagged,
      },
    });
    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: message.createdAt },
    });
    this.publish(
      conv.id,
      {
        id: message.id,
        conversationId: conv.id,
        senderId: conv.sellerId,
        body: masked,
        isFlagged: flagged,
        createdAt: message.createdAt,
        readAt: null,
      },
      [conv.buyerId, conv.sellerId],
    );
  }

  /** Ник отправителя — для пуша «Сообщение от …». */
  private async nameOf(userId: string): Promise<string | null> {
    const p = await this.prisma.profile.findUnique({ where: { userId }, select: { username: true } });
    return p?.username ?? null;
  }

  /** Системное сообщение о событии сделки в чат заказа (senderId = null). */
  async postSystem(orderId: string, text: string): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { orderId },
      select: { id: true, buyerId: true, sellerId: true },
    });
    if (conv) await this.system(conv, text);
  }

  private async system(
    conv: { id: string; buyerId: string; sellerId: string },
    text: string,
  ): Promise<ChatMessageDto> {
    const message = await this.prisma.message.create({
      data: { conversationId: conv.id, senderId: null, type: 'system', body: text },
    });
    await this.prisma.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: message.createdAt },
    });
    const dto: ChatMessageDto = {
      id: message.id,
      conversationId: conv.id,
      senderId: null,
      body: text,
      isFlagged: false,
      createdAt: message.createdAt,
      readAt: null,
    };
    this.publish(conv.id, dto, [conv.buyerId, conv.sellerId]);
    return dto;
  }
}
