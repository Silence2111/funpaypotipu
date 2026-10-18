'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { isOnline } from '@/lib/presence';
import { listTime, ORDER_STATUS_LABELS, useChatSocket, type ChatMsg, type ConversationItem } from '@/lib/chat';
import { Avatar } from './offers';

/**
 * Список диалогов мессенджера, как у FunPay: собеседник и в сети ли он,
 * последнее сообщение, время, непрочитанные, заказ, если диалог по сделке.
 * Новые сообщения поднимают диалог наверх без перезагрузки.
 */
export function ChatList({ activeId, meId }: { activeId?: string; meId: string }) {
  const socket = useChatSocket();
  const [items, setItems] = useState<ConversationItem[] | null>(null);
  const [q, setQ] = useState('');
  const active = useRef(activeId);
  active.current = activeId;

  // Открытый диалог читается сразу — список, пришедший позже, не должен
  // показывать у него непрочитанные.
  const load = useCallback(() => {
    apiFetch<ConversationItem[]>('/conversations')
      .then((rows) => setItems(rows.map((c) => (c.id === active.current ? { ...c, unread: 0 } : c))))
      .catch(() => setItems((prev) => prev ?? []));
  }, []);
  useEffect(load, [load]);

  // Открытый диалог прочитан: его счётчик гаснет сразу, не дожидаясь списка.
  useEffect(() => {
    if (!activeId) return;
    setItems((prev) => prev?.map((c) => (c.id === activeId ? { ...c, unread: 0 } : c)) ?? prev);
  }, [activeId]);

  useEffect(() => {
    if (!socket) return;
    const onUpdate = ({ conversationId, message }: { conversationId: string; message: ChatMsg }) => {
      setItems((prev) => {
        if (!prev) return prev;
        const conv = prev.find((c) => c.id === conversationId);
        // Новый диалог (первое сообщение от покупателя) — список целиком заново.
        if (!conv) {
          load();
          return prev;
        }
        const incoming = message.senderId !== null && message.senderId !== meId;
        // Шапка пересчитает непрочитанные.
        if (incoming) window.dispatchEvent(new Event('gm-unread'));
        const updated: ConversationItem = {
          ...conv,
          lastMessageAt: message.createdAt,
          unread: incoming && conversationId !== activeId ? conv.unread + 1 : conv.unread,
          last: {
            senderId: message.senderId,
            system: message.senderId === null,
            text: message.attachments?.length ? 'Вложение' : message.body,
            createdAt: message.createdAt,
          },
        };
        return [updated, ...prev.filter((c) => c.id !== conversationId)];
      });
    };
    socket.on('conversation:update', onUpdate);
    return () => {
      socket.off('conversation:update', onUpdate);
    };
  }, [socket, meId, activeId, load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!items || !t) return items;
    return items.filter(
      (c) => c.counterpart.username.toLowerCase().includes(t) || c.order?.title.toLowerCase().includes(t),
    );
  }, [items, q]);

  return (
    <>
      <div className="messenger-list-head">
        <h1 className="h2" style={{ fontSize: 22 }}>
          Сообщения
        </h1>
        <div className="filter-search" style={{ maxWidth: 'none', marginTop: 12 }}>
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            className="input"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по имени или заказу"
            aria-label="Поиск по диалогам"
          />
        </div>
      </div>
      <nav className="conv-list" aria-label="Диалоги">
        {shown === null ? null : shown.length === 0 ? (
          <p className="muted" style={{ padding: '16px 20px', fontSize: 14, margin: 0 }}>
            {q ? 'Никого не нашлось.' : 'Диалогов пока нет. Напишите продавцу со страницы лота — переписка появится здесь.'}
          </p>
        ) : (
          shown.map((c) => {
            const mine = c.last?.senderId === meId;
            return (
              <Link
                key={c.id}
                href={`/chat/${c.id}`}
                className="conv-item"
                aria-current={c.id === activeId ? 'page' : undefined}
              >
                <Avatar
                  name={c.counterpart.username}
                  url={c.counterpart.avatarUrl}
                  online={isOnline(c.counterpart.onlineAt)}
                  size={44}
                />
                <span className="conv-main">
                  <span className="conv-name">{c.counterpart.username}</span>
                  <span className="conv-context">
                    {c.order
                      ? `${c.role === 'buyer' ? 'Покупка' : 'Продажа'} ${c.order.publicNumber} · ${ORDER_STATUS_LABELS[c.order.status] ?? c.order.status}`
                      : 'До покупки'}
                  </span>
                  <span className="conv-preview" data-unread={c.unread > 0 ? 'true' : undefined}>
                    {c.last ? `${mine ? 'Вы: ' : ''}${c.last.text}` : 'Сообщений пока нет'}
                  </span>
                </span>
                <span className="conv-meta">
                  <time dateTime={c.lastMessageAt}>{listTime(c.lastMessageAt)}</time>
                  {c.unread > 0 && (
                    <span className="conv-unread" aria-label={`Непрочитанных: ${c.unread}`}>
                      {c.unread > 99 ? '99+' : c.unread}
                    </span>
                  )}
                </span>
              </Link>
            );
          })
        )}
      </nav>
    </>
  );
}
