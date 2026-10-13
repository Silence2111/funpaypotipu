'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Paperclip } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { uploadViaPresignedUrl } from '@/lib/upload';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Attachment {
  url: string;
  mime: string;
}
interface Msg {
  id: string;
  senderId: string | null;
  body: string;
  isFlagged: boolean;
  attachments?: Attachment[];
}

export function OrderChat({ conversationId, meId }: { conversationId: string; meId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let active = true;
    const markRead = () =>
      apiFetch(`/conversations/${conversationId}/read`, { method: 'POST' }).catch(() => {});
    apiFetch<Msg[]>(`/conversations/${conversationId}/messages`)
      .then((m) => {
        if (active) setMessages(m);
        markRead();
      })
      .catch(() => {});

    const socket = io(`${API}/chat`, {
      auth: { token: getToken() },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setLive(true);
      socket.emit('conversation:join', { conversationId });
    });
    socket.on('disconnect', () => setLive(false));
    socket.on('message:new', (msg: Msg) => {
      setMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]));
      if (msg.senderId && msg.senderId !== meId) markRead();
    });

    return () => {
      active = false;
      socket.disconnect();
    };
  }, [conversationId, meId]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    setErr(null);
    // Отказ (например, чёрный список) возвращает текст в поле и объясняет причину.
    const fail = (text: string) => {
      setErr(text);
      setDraft(body);
    };
    const socket = socketRef.current;
    if (socket && live) {
      // Само сообщение придёт как message:new, в ответе — только отказ.
      socket.emit('message:send', { conversationId, body }, (res?: { error?: string }) => {
        if (res?.error) fail(res.error);
      });
    } else {
      try {
        const msg = await apiFetch<Msg>(`/conversations/${conversationId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body }),
        });
        setMessages((prev) => [...prev, msg]);
      } catch (e) {
        fail(apiErrorMessage(e, 'Сообщение не отправлено. Попробуйте ещё раз.'));
      }
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const att = await uploadViaPresignedUrl(`/conversations/${conversationId}/uploads`, file);
      const msg = await apiFetch<Msg>(`/conversations/${conversationId}/attachments`, {
        method: 'POST',
        body: JSON.stringify(att),
      });
      setMessages((prev) => [...prev, msg]);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Файл не отправлен: хранилище недоступно или файл не прошёл проверку.'));
    }
  }

  return (
    <>
      <div className="row" style={{ gap: 6, marginBottom: 12 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: live ? 'var(--success)' : '#c7c7cc',
          }}
        />
        <span className="faint" style={{ fontSize: 12 }}>
          {live ? 'онлайн' : 'переподключение…'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {messages.map((m) =>
          m.senderId === null ? (
            <div key={m.id} className="faint" style={{ textAlign: 'center', fontSize: 12.5, padding: '2px 8px' }}>
              {m.body}
            </div>
          ) : (
          <div key={m.id} className={`bubble ${m.senderId === meId ? 'mine' : 'their'}`}>
            {m.attachments?.length ? (
              m.attachments.map((a, i) =>
                a.mime.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={a.url} alt="вложение" style={{ maxWidth: 200, borderRadius: 8, display: 'block' }} />
                ) : (
                  <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                    Вложение
                  </a>
                ),
              )
            ) : (
              m.body
            )}
          </div>
          ),
        )}
        {!messages.length && (
          <p className="muted" style={{ fontSize: 14 }}>
            Сообщений пока нет.
          </p>
        )}
      </div>

      <form onSubmit={send} className="row" style={{ gap: 8 }}>
        <label className="chip" style={{ cursor: 'pointer' }} aria-label="Прикрепить файл">
          <Paperclip size={16} strokeWidth={1.75} />
          <input type="file" onChange={onFile} style={{ display: 'none' }} />
        </label>
        <input
          className="input"
          placeholder="Сообщение…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn" type="submit">
          Отправить
        </button>
      </form>
      {err && (
        <p className="field-error" role="alert" style={{ marginTop: 8 }}>
          {err}
        </p>
      )}
      <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
        Контакты (телефоны, ники, ссылки) скрываются автоматически.
      </p>
    </>
  );
}
