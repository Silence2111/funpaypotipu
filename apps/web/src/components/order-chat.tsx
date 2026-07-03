'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiFetch, getToken } from '@/lib/session';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Msg {
  id: string;
  senderId: string | null;
  body: string;
  isFlagged: boolean;
}

export function OrderChat({ conversationId, meId }: { conversationId: string; meId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<Msg[]>(`/conversations/${conversationId}/messages`)
      .then((m) => active && setMessages(m))
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
    });

    return () => {
      active = false;
      socket.disconnect();
    };
  }, [conversationId]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    const socket = socketRef.current;
    if (socket && live) {
      socket.emit('message:send', { conversationId, body }); // ответ придёт как message:new
    } else {
      const msg = await apiFetch<Msg>(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setMessages((prev) => [...prev, msg]);
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
            background: live ? '#34c759' : '#c7c7cc',
          }}
        />
        <span className="faint" style={{ fontSize: 12 }}>
          {live ? 'онлайн' : 'переподключение…'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.senderId === meId ? 'mine' : 'their'}`}>
            {m.body}
          </div>
        ))}
        {!messages.length && (
          <p className="muted" style={{ fontSize: 14 }}>
            Сообщений пока нет.
          </p>
        )}
      </div>

      <form onSubmit={send} className="row" style={{ gap: 8 }}>
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
      <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
        Контакты (телефоны, ники, ссылки) скрываются автоматически.
      </p>
    </>
  );
}
