'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { isOnline } from '@/lib/presence';
import {
  listTime,
  ORDER_STATUS_LABELS,
  previewText,
  useChatSocket,
  type ChatMsg,
  type ConversationItem,
} from '@/lib/chat';
import { useT } from '@/lib/i18n/client';
import { Avatar } from './offers';

/** Сколько диалогов за раз; ещё один в запросе — узнать, есть ли дальше. */
const PAGE = 50;

/** Найденное базой по тексту поиска. */
interface Found {
  q: string;
  items: ConversationItem[];
  more: boolean;
}

/** Страница списка; after — последний показанный диалог, «Показать ещё» продолжает с него. */
async function fetchPage(q: string, after?: ConversationItem) {
  const p = new URLSearchParams({ limit: String(PAGE + 1) });
  if (q) p.set('q', q);
  if (after) {
    p.set('before', after.lastMessageAt);
    p.set('beforeId', after.id);
  }
  const rows = await apiFetch<ConversationItem[]>(`/conversations?${p}`);
  return { items: rows.slice(0, PAGE), more: rows.length > PAGE };
}

/** Добавить страницу к списку без повторов. */
function append(list: ConversationItem[], page: ConversationItem[]) {
  const seen = new Set(list.map((c) => c.id));
  return [...list, ...page.filter((c) => !seen.has(c.id))];
}

/**
 * Список диалогов мессенджера, как у FunPay: собеседник и в сети ли он,
 * последнее сообщение, время, непрочитанные, заказ, если диалог по сделке.
 * Новые сообщения поднимают диалог наверх без перезагрузки.
 *
 * Список — по 50 и «Показать ещё», а поиск идёт в базе. Раньше приходили
 * 200 последних диалогов и искалось только среди них: у продавца с
 * тысячами заказов старая переписка не находилась вовсе.
 */
export function ChatList({ activeId, meId }: { activeId?: string; meId: string }) {
  const t = useT();
  const socket = useChatSocket();
  const [items, setItems] = useState<ConversationItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef(activeId);
  active.current = activeId;
  const loaded = useRef(items);
  loaded.current = items;

  // Открытый диалог читается сразу — список, пришедший позже, не должен
  // показывать у него непрочитанные.
  const read = useCallback(
    (rows: ConversationItem[]) => rows.map((c) => (c.id === active.current ? { ...c, unread: 0 } : c)),
    [],
  );

  useEffect(() => {
    fetchPage('')
      .then((p) => {
        setItems(read(p.items));
        setMore(p.more);
      })
      .catch(() => setItems((prev) => prev ?? []));
  }, [read]);

  // Поиск — после паузы в наборе; ответ на прежний текст новый не перетирает.
  const needle = q.trim();
  useEffect(() => {
    setFailed(false);
    if (!needle) {
      setFound(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      fetchPage(needle)
        .then((p) => {
          if (!stale) setFound({ q: needle, items: read(p.items), more: p.more });
        })
        .catch(() => {
          if (!stale) setFailed(true);
        });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [needle, read]);

  // Открытый диалог прочитан: его счётчик гаснет сразу, не дожидаясь списка.
  useEffect(() => {
    if (!activeId) return;
    const zero = (list: ConversationItem[]) => list.map((c) => (c.id === activeId ? { ...c, unread: 0 } : c));
    setItems((prev) => (prev ? zero(prev) : prev));
    setFound((f) => (f ? { ...f, items: zero(f.items) } : f));
  }, [activeId]);

  useEffect(() => {
    if (!socket) return;
    const onUpdate = ({ conversationId, message }: { conversationId: string; message: ChatMsg }) => {
      const incoming = message.senderId !== null && message.senderId !== meId;
      // Шапка пересчитает непрочитанные.
      if (incoming) window.dispatchEvent(new Event('gm-unread'));
      const lift = (list: ConversationItem[]) => {
        const conv = list.find((c) => c.id === conversationId);
        if (!conv) return list;
        const updated: ConversationItem = {
          ...conv,
          lastMessageAt: message.createdAt,
          unread: incoming && conversationId !== activeId ? conv.unread + 1 : conv.unread,
          last: {
            senderId: message.senderId,
            system: message.senderId === null,
            text: message.attachments?.length ? 'Вложение' : message.body, // i18n-ignore — как пишет API
            createdAt: message.createdAt,
          },
        };
        return [updated, ...list.filter((c) => c.id !== conversationId)];
      };
      setFound((f) => (f ? { ...f, items: lift(f.items) } : f));
      if (loaded.current && !loaded.current.some((c) => c.id === conversationId)) {
        // Диалога нет среди загруженных — новый или старее показанных:
        // берём его одного и ставим наверх, остальной список не трогаем.
        apiFetch<ConversationItem>(`/conversations/${conversationId}`)
          .then((c) => setItems((prev) => prev && [...read([c]), ...prev.filter((x) => x.id !== c.id)]))
          .catch(() => {});
        return;
      }
      setItems((prev) => (prev ? lift(prev) : prev));
    };
    socket.on('conversation:update', onUpdate);
    return () => {
      socket.off('conversation:update', onUpdate);
    };
  }, [socket, meId, activeId, read]);

  // Пока база ищет, видно найденное среди загруженных.
  const ready = !needle || found?.q === needle;
  const nearby = useMemo(() => {
    const low = needle.toLowerCase();
    if (!items || !low) return items;
    return items.filter(
      (c) =>
        c.counterpart.username.toLowerCase().includes(low) ||
        c.order?.title.toLowerCase().includes(low) ||
        c.order?.publicNumber.toLowerCase().includes(low),
    );
  }, [items, needle]);
  const shown = !needle ? items : ready ? found!.items : nearby;
  const hasMore = !needle ? more : ready && found!.more;

  async function showMore() {
    const searching = needle;
    const list = searching ? found?.items : items;
    const last = list?.[list.length - 1];
    if (!last || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const p = await fetchPage(searching, last);
      if (searching) {
        setFound((f) => (f && f.q === searching ? { ...f, items: append(f.items, read(p.items)), more: p.more } : f));
      } else {
        setItems((prev) => append(prev ?? [], read(p.items)));
        setMore(p.more);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="messenger-list-head">
        <h1 className="h2" style={{ fontSize: 22 }}>
          {t('Сообщения')}
        </h1>
        <div className="filter-search" style={{ maxWidth: 'none', marginTop: 12 }}>
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            className="input"
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('Поиск по имени или заказу')}
            aria-label={t('Поиск по диалогам')}
          />
        </div>
      </div>
      <nav className="conv-list" aria-label={t('Диалоги')}>
        {shown === null || (shown.length === 0 && !ready) ? null : shown.length === 0 ? (
          <p className="muted" style={{ padding: '16px 20px', fontSize: 14, margin: 0 }}>
            {needle
              ? t('Никого не нашлось.')
              : t('Диалогов пока нет. Напишите продавцу со страницы лота — переписка появится здесь.')}
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
                  t={t}
                />
                <span className="conv-main">
                  <span className="conv-name">{c.counterpart.username}</span>
                  <span className="conv-context">
                    {c.order
                      ? `${c.role === 'buyer' ? t('Покупка {n}', { n: c.order.publicNumber }) : t('Продажа {n}', { n: c.order.publicNumber })} · ${ORDER_STATUS_LABELS[c.order.status] ? t(ORDER_STATUS_LABELS[c.order.status]!) : c.order.status}`
                      : t('До покупки')}
                  </span>
                  <span className="conv-preview" data-unread={c.unread > 0 ? 'true' : undefined}>
                    {c.last ? `${mine ? `${t('Вы:')} ` : ''}${previewText(t, c.last)}` : t('Сообщений пока нет')}
                  </span>
                </span>
                <span className="conv-meta">
                  <time dateTime={c.lastMessageAt}>{listTime(c.lastMessageAt, new Date(), t)}</time>
                  {c.unread > 0 && (
                    <span className="conv-unread" aria-label={t('Непрочитанных: {n}', { n: c.unread })}>
                      {c.unread > 99 ? '99+' : c.unread}
                    </span>
                  )}
                </span>
              </Link>
            );
          })
        )}
        {failed && (
          <p className="muted" role="alert" style={{ padding: '12px 16px', fontSize: 14, margin: 0 }}>
            {t('Не удалось загрузить диалоги. Попробуйте ещё раз.')}
          </p>
        )}
        {hasMore && (
          <div className="conv-more">
            <button type="button" className="btn secondary block" disabled={busy} onClick={() => void showMore()}>
              {busy ? '…' : t('Показать ещё')}
            </button>
          </div>
        )}
      </nav>
    </>
  );
}
