import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { TokenService } from '../auth/token.service';
import { ChatService } from './chat.service';

const room = (conversationId: string) => `conv:${conversationId}`;
/** Личная комната: список диалогов и счётчик непрочитанных обновляются без перезагрузки. */
const userRoom = (userId: string) => `user:${userId}`;

/**
 * Realtime-чат (docs/05). Аутентификация по access-токену на handshake,
 * комнаты по диалогам, persist-then-broadcast через ChatService.
 * Масштабирование на несколько инстансов — через Redis-адаптер (позже).
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: true, credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayInit {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly chat: ChatService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  /** Забаненный не пишет и через сокет: соединение живёт дольше, чем решение модератора. */
  private async banned(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    return !user || user.status === 'banned';
  }

  /**
   * Вход проверяется до подключения — в middleware пространства. Раньше токен
   * и бан проверялись в handleConnection, а клиент шлёт conversation:join
   * сразу после connect: join приходил раньше, чем пользователь дочитывался
   * из базы, получал «unauthorized», и открытый чат молчал до перезагрузки.
   *
   * Любое новое сообщение — из сокета, REST или системное — уходит в комнату
   * диалога (открытый чат) и в личные комнаты участников (список диалогов).
   */
  afterInit(server: Server) {
    server.use((client, next) => {
      this.authenticate(client).then(
        () => next(),
        () => next(new Error('unauthorized')),
      );
    });
    this.chat.setPublisher((conversationId, message, participants) => {
      server.to(room(conversationId)).emit('message:new', message);
      for (const p of participants) server.to(userRoom(p)).emit('conversation:update', { conversationId, message });
    });
    this.chat.setReadPublisher((conversationId, readerId, at) =>
      server.to(room(conversationId)).emit('message:read', { conversationId, readerId, at }),
    );
  }

  private async authenticate(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) throw new Error('no token');
    const payload = this.tokens.verifyAccess(token);
    if (await this.banned(payload.sub)) throw new Error('banned');
    client.data.userId = payload.sub;
  }

  /** Сюда доходит только проверенный в afterInit пользователь. */
  async handleConnection(client: Socket) {
    await client.join(userRoom(client.data.userId as string));
  }

  @SubscribeMessage('conversation:join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return { error: 'unauthorized' };
    await this.chat.assertParticipant(data.conversationId, userId);
    await client.join(room(data.conversationId));
    return { ok: true };
  }

  /** «Печатает…»: собеседнику в открытом диалоге. Клиент шлёт не чаще раза в три секунды. */
  @SubscribeMessage('typing')
  typing(@ConnectedSocket() client: Socket, @MessageBody() data: { conversationId: string }) {
    const userId = client.data.userId as string | undefined;
    // Только из комнаты, в которую клиент вошёл через conversation:join —
    // там участие уже проверено.
    if (!userId || !client.rooms.has(room(data?.conversationId))) return;
    client.to(room(data.conversationId)).emit('typing', { conversationId: data.conversationId, userId });
  }

  @SubscribeMessage('message:send')
  async onMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; body: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return { error: 'unauthorized' };
    if (await this.banned(userId)) {
      client.disconnect(true);
      return { error: 'unauthorized' };
    }
    // В комнату сообщение отправляет сам ChatService (afterInit). Отказ —
    // ответом на emit: исключение сокет отдал бы как «Internal server error»,
    // и клиент молча терял бы сообщение (например, при чёрном списке).
    try {
      return await this.chat.sendMessage(data.conversationId, userId, data.body);
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Сообщение не отправлено' };
    }
  }
}
