'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, MessageSquareText, Paperclip, SendHorizontal } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { uploadViaPresignedUrl } from '@/lib/upload';
import { isOnline, presenceText, replyWhen } from '@/lib/presence';
import {
  dayLabel,
  ORDER_STATUS_LABELS,
  systemText,
  useChatSocket,
  useSocketLive,
  type ChatMsg,
  type ConversationItem,
} from '@/lib/chat';
import { fillTemplate } from '@gamemarket/shared';
import { Avatar } from './offers';
import { useT } from '@/lib/i18n/client';

const PAGE = 50;
const TYPING_MS = 4000;

interface Template {
  id: string;
  title: string;
  body: string;
  /** По этой команде покупателя заготовка уходит сама. */
  command: string | null;
}

/**
 * Диалог: шапка с собеседником и заказом, сообщения с днями и временем,
 * «прочитано» у своих, «печатает…», история при прокрутке вверх и поле
 * ввода (Enter — отправить, Shift+Enter — новая строка).
 *
 * `embedded` — чат на странице заказа или лота: без шапки, заказ или лот
 * и так на экране. `aboutListingId` — чат на странице лота: сообщение уходит
 * «о лоте», и продавец видит, о каком лоте вопрос.
 */
export function ChatThread({
  conversationId,
  meId,
  embedded = false,
  aboutListingId,
}: {
  conversationId: string;
  meId: string;
  embedded?: boolean;
  aboutListingId?: string;
}) {
  const t = useT();
  const socket = useChatSocket();
  const live = useSocketLive(socket);
  const [info, setInfo] = useState<ConversationItem | null>(null);
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [typingAt, setTypingAt] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // держать прокрутку у последнего сообщения
  const keepFrom = useRef<number | null>(null); // высота до подгрузки истории
  const lastTyping = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  // Заготовки ответов: загружаются при первом открытии списка.
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tplOpen, setTplOpen] = useState(false);

  // Сообщение может прийти дважды — ответом на отправку и по сокету.
  const add = useCallback(
    (rows: ChatMsg[]) =>
      setMessages((prev) => (prev ? [...prev, ...rows.filter((m) => !prev.some((x) => x.id === m.id))] : prev)),
    [],
  );

  // Прочитал — шапка гасит счётчик сразу, не дожидаясь своего опроса.
  const markRead = useCallback(
    () =>
      apiFetch(`/conversations/${conversationId}/read`, { method: 'POST' })
        .then(() => window.dispatchEvent(new Event('gm-unread')))
        .catch(() => {}),
    [conversationId],
  );

  useEffect(() => {
    setMessages(null);
    setInfo(null);
    stick.current = true;
    apiFetch<ChatMsg[]>(`/conversations/${conversationId}/messages?limit=${PAGE}`)
      .then((m) => {
        setMessages(m);
        setHasMore(m.length === PAGE);
        markRead();
      })
      .catch((e) => {
        setMessages([]);
        setErr(apiErrorMessage(e, t('Диалог не открылся. Обновите страницу.')));
      });
    if (!embedded) {
      apiFetch<ConversationItem>(`/conversations/${conversationId}`)
        .then(setInfo)
        .catch(() => {});
    }
  }, [conversationId, embedded, markRead, t]);

  useEffect(() => {
    if (!socket) return;
    const join = () => socket.emit('conversation:join', { conversationId });
    const onNew = (msg: ChatMsg) => {
      if (msg.conversationId !== conversationId) return;
      add([msg]);
      if (msg.senderId && msg.senderId !== meId) {
        setTypingAt(0);
        if (document.visibilityState === 'visible') markRead();
      }
    };
    const onRead = (e: { conversationId: string; readerId: string; at: string }) => {
      if (e.conversationId !== conversationId || e.readerId === meId) return;
      setMessages((prev) => prev?.map((m) => (m.senderId === meId && !m.readAt ? { ...m, readAt: e.at } : m)) ?? prev);
    };
    const onTyping = (e: { conversationId: string; userId: string }) => {
      if (e.conversationId === conversationId && e.userId !== meId) setTypingAt(Date.now());
    };
    if (socket.connected) join();
    socket.on('connect', join);
    socket.on('message:new', onNew);
    socket.on('message:read', onRead);
    socket.on('typing', onTyping);
    return () => {
      socket.off('connect', join);
      socket.off('message:new', onNew);
      socket.off('message:read', onRead);
      socket.off('typing', onTyping);
    };
  }, [socket, conversationId, meId, markRead, add]);

  // «Печатает…» гаснет само, если собеседник замолчал.
  useEffect(() => {
    if (!typingAt) return;
    const timer = setTimeout(() => setTypingAt(0), TYPING_MS);
    return () => clearTimeout(timer);
  }, [typingAt]);

  // Прокрутка: к последнему сообщению — если пользователь и так был внизу;
  // после подгрузки истории — на прежнее место.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || !messages) return;
    if (keepFrom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, typingAt]);

  async function older() {
    const first = messages?.[0];
    if (!first) return;
    const rows = await apiFetch<ChatMsg[]>(
      `/conversations/${conversationId}/messages?limit=${PAGE}&before=${encodeURIComponent(first.createdAt)}`,
    ).catch(() => [] as ChatMsg[]);
    keepFrom.current = body.current ? body.current.scrollHeight - body.current.scrollTop : null;
    setHasMore(rows.length === PAGE);
    setMessages((prev) => [...rows, ...(prev ?? [])]);
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setErr(null);
    stick.current = true;
    // Отказ (например, чёрный список) возвращает текст в поле и объясняет причину.
    const fail = (reason: string) => {
      setErr(reason);
      setDraft(text);
    };
    if (aboutListingId) {
      // Со страницы лота — через лот: перед вопросом о новом лоте встанет
      // строка «Вопрос о лоте …».
      try {
        const res = await apiFetch<{ messages?: ChatMsg[] }>(`/conversations/for-listing/${aboutListingId}`, {
          method: 'POST',
          body: JSON.stringify({ body: text }),
        });
        add(res.messages ?? []);
      } catch (er) {
        fail(apiErrorMessage(er, t('Сообщение не отправлено. Попробуйте ещё раз.')));
      }
      return;
    }
    if (socket && live) {
      // Само сообщение придёт как message:new, в ответе — только отказ.
      // Язык — чтобы отказ пришёл на языке сайта: фильтр ошибок API сокет не проходит.
      socket.emit('message:send', { conversationId, body: text, lang: t.lang }, (res?: { error?: string; lang?: string }) => {
        if (!res?.error) return;
        const readable = res.error !== 'unauthorized' && (t.lang === 'en' ? res.lang === 'en' : true);
        fail(readable ? res.error : t('Сообщение не отправлено. Попробуйте ещё раз.'));
      });
      return;
    }
    try {
      const msg = await apiFetch<ChatMsg>(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      });
      add([msg]);
    } catch (er) {
      fail(apiErrorMessage(er, t('Сообщение не отправлено. Попробуйте ещё раз.')));
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(null);
    try {
      const att = await uploadViaPresignedUrl(`/conversations/${conversationId}/uploads`, file);
      const msg = await apiFetch<ChatMsg>(`/conversations/${conversationId}/attachments`, {
        method: 'POST',
        body: JSON.stringify(att),
      });
      stick.current = true;
      add([msg]);
    } catch (er) {
      setErr(apiErrorMessage(er, t('Файл не отправлен: хранилище недоступно или файл не прошёл проверку.')));
    }
  }

  function openTemplates() {
    setTplOpen((open) => !open);
    if (templates === null) {
      apiFetch<Template[]>('/seller-tools/templates')
        .then(setTemplates)
        .catch(() => setTemplates([]));
    }
    // В чате заказа шапки нет — ник собеседника для {имя} берём отдельно.
    if (!info) {
      apiFetch<ConversationItem>(`/conversations/${conversationId}`)
        .then(setInfo)
        .catch(() => {});
    }
  }

  function insertTemplate(tp: Template) {
    const text = fillTemplate(tp.body, info?.counterpart.username);
    setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, '')}\n${text}` : text));
    setTplOpen(false);
    input.current?.focus();
  }

  function onType(value: string) {
    setDraft(value);
    const now = Date.now();
    if (socket && live && value && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      socket.emit('typing', { conversationId });
    }
  }

  const other = info?.counterpart;
  const typing = typingAt > 0;
  let lastDay = '';

  return (
    <div className={embedded ? 'thread embedded' : 'thread'}>
      {!embedded && (
        <header className="thread-head">
          <Link href="/chat" className="chip only-mobile-flex" aria-label={t('Все диалоги')}>
            <ArrowLeft size={16} strokeWidth={1.75} />
          </Link>
          {other ? (
            <>
              <Avatar name={other.username} url={other.avatarUrl} online={isOnline(other.onlineAt)} size={40} t={t} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link href={`/prodavec/${other.id}`} className="thread-name">
                  {other.username}
                </Link>
                <div className="thread-sub">
                  {typing ? (
                    t('печатает…')
                  ) : (
                    <>
                      {presenceText(other.onlineAt, Date.now(), t) ?? t('не в сети')}
                      {/* Не в сети — когда ждать ответа: по живым ответам продавца. */}
                      {other.replyTime && !isOnline(other.onlineAt) && (
                        <> · {t('обычно отвечает {when}', { when: replyWhen(other.replyTime, t) })}</>
                      )}
                    </>
                  )}
                </div>
              </div>
              {info?.order && info.orderId && (
                <Link href={`/orders/${info.orderId}`} className="chip thread-order">
                  {info.role === 'buyer'
                    ? t('Покупка {n}', { n: info.order.publicNumber })
                    : t('Продажа {n}', { n: info.order.publicNumber })}{' '}
                  ·{' '}
                  {ORDER_STATUS_LABELS[info.order.status]
                    ? t(ORDER_STATUS_LABELS[info.order.status]!)
                    : info.order.status}
                </Link>
              )}
            </>
          ) : (
            <div style={{ height: 40 }} />
          )}
        </header>
      )}

      <div
        className="thread-body"
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        aria-live="polite"
      >
        {hasMore && (
          <button type="button" className="chip" style={{ alignSelf: 'center' }} onClick={() => void older()}>
            {t('Показать раньше')}
          </button>
        )}
        {messages?.length === 0 && (
          <p className="muted" style={{ textAlign: 'center', fontSize: 14, margin: 'auto 0' }}>
            {t('Сообщений пока нет. Всё, что написано здесь, увидит арбитр при споре.')}
          </p>
        )}
        {messages?.map((m) => {
          const day = dayLabel(m.createdAt, new Date(), t);
          const sep = day !== lastDay;
          lastDay = day;
          const time = new Date(m.createdAt).toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' });
          const mine = m.senderId === meId;
          return (
            <Fragment key={m.id}>
              {sep && <div className="day-sep">{day}</div>}
              {m.senderId === null ? (
                <div className="sys-msg">{systemText(t, m.body)}</div>
              ) : (
                <div className={`bubble ${mine ? 'mine' : 'their'}`}>
                  {m.attachments?.length ? (
                    m.attachments.map((a, i) =>
                      a.mime.startsWith('image/') ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={a.url} alt={t('вложение')} className="bubble-img" />
                      ) : (
                        <a key={i} href={a.url} target="_blank" rel="noreferrer" className="bubble-file">
                          {t('Вложение')}
                        </a>
                      ),
                    )
                  ) : (
                    <span className="bubble-text">{m.body}</span>
                  )}
                  <span className="bubble-time">
                    {m.auto && <span className="bubble-auto">{t('автоответ')} · </span>}
                    {time}
                    {mine && (
                      <span
                        aria-label={m.readAt ? t('прочитано') : t('доставлено')}
                        title={m.readAt ? t('прочитано') : t('доставлено')}
                      >
                        {' '}
                        {m.readAt ? '✓✓' : '✓'}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </Fragment>
          );
        })}
        {typing && embedded && <div className="typing">{t('печатает…')}</div>}
      </div>

      {err && (
        <p className="field-error thread-err" role="alert">
          {err}
        </p>
      )}
      {tplOpen && (
        <div className="tpl-menu" role="menu" aria-label={t('Заготовки ответов')}>
          {templates === null ? (
            <div className="skeleton" style={{ height: 44 }} aria-busy="true" />
          ) : templates.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>{t('Заготовок пока нет.')}</p>
          ) : (
            templates.map((tp) => (
              <button key={tp.id} type="button" role="menuitem" className="tpl-item" onClick={() => insertTemplate(tp)}>
                <span className="tpl-title">
                  {tp.title}
                  {tp.command && <span className="cmd">{tp.command}</span>}
                </span>
                <span className="tpl-body">{tp.body}</span>
              </button>
            ))
          )}
          <Link href="/cabinet/tools" className="inline-link tpl-manage">
            {templates?.length ? t('Изменить заготовки') : t('Добавить заготовки')}
          </Link>
        </div>
      )}
      <form className="thread-compose" onSubmit={send}>
        <label className="chip" style={{ cursor: 'pointer' }} aria-label={t('Прикрепить файл')} title={t('Прикрепить файл')}>
          <Paperclip size={16} strokeWidth={1.75} />
          <input type="file" onChange={onFile} style={{ display: 'none' }} />
        </label>
        <button
          type="button"
          className="chip"
          aria-label={t('Заготовки ответов')}
          title={t('Заготовки ответов')}
          aria-expanded={tplOpen}
          onClick={openTemplates}
        >
          <MessageSquareText size={16} strokeWidth={1.75} />
        </button>
        <textarea
          ref={input}
          className="input"
          rows={1}
          enterKeyHint="send"
          value={draft}
          maxLength={4000}
          placeholder={live || !socket ? t('Сообщение') : t('Переподключение… сообщение уйдёт через сайт')}
          aria-label={t('Сообщение')}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn" type="submit" aria-label={t('Отправить')} disabled={!draft.trim()}>
          <SendHorizontal size={18} strokeWidth={1.75} />
        </button>
      </form>
      <p className="thread-note">{t('Телефоны, ники в мессенджерах и ссылки скрываются автоматически.')}</p>
    </div>
  );
}
