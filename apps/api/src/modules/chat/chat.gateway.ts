import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { TokenService } from '../auth/token.service';
import { ChatService } from './chat.service';

const room = (conversationId: string) => `conv:${conversationId}`;

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
  ) {}

  /** Любое новое сообщение — из сокета, REST или системное — уходит в комнату диалога. */
  afterInit(server: Server) {
    this.chat.setPublisher((conversationId, message) =>
      server.to(room(conversationId)).emit('message:new', message),
    );
  }

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('no token');
      const payload = this.tokens.verifyAccess(token);
      client.data.userId = payload.sub;
    } catch {
      client.disconnect(true);
    }
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

  @SubscribeMessage('message:send')
  async onMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; body: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return { error: 'unauthorized' };
    // В комнату сообщение отправляет сам ChatService (afterInit).
    return this.chat.sendMessage(data.conversationId, userId, data.body);
  }
}
