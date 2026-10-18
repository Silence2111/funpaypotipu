'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getToken } from './session';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Диалог в списке мессенджера — ответ `GET /conversations`. */
export interface ConversationItem {
  id: string;
  orderId: string | null;
  lastMessageAt: string;
  /** Кто я в этом диалоге. */
  role: 'buyer' | 'seller';
  unread: number;
  counterpart: { id: string; username: string; avatarUrl: string | null; onlineAt: string | null };
  order: { publicNumber: string; status: string; title: string } | null;
  last: { senderId: string | null; system: boolean; text: string; createdAt: string } | null;
}

export interface ChatMsg {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string;
  isFlagged: boolean;
  attachments?: Array<{ url: string; mime: string }>;
  createdAt: string;
  readAt?: string | null;
}

const Ctx = createContext<{ socket: Socket | null; shared: boolean }>({ socket: null, shared: false });

function connect(): Socket | null {
  const token = getToken();
  return token ? io(`${API}/chat`, { auth: { token }, transports: ['websocket', 'polling'] }) : null;
}

/** Одно соединение на мессенджер: список диалогов и открытый диалог слушают его вместе. */
export function ChatSocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  useEffect(() => {
    const s = connect();
    setSocket(s);
    return () => {
      s?.disconnect();
    };
  }, []);
  return <Ctx.Provider value={{ socket, shared: true }}>{children}</Ctx.Provider>;
}

/** Сокет мессенджера; вне него (чат на странице заказа) — своё соединение. */
export function useChatSocket(): Socket | null {
  const ctx = useContext(Ctx);
  const [own, setOwn] = useState<Socket | null>(null);
  useEffect(() => {
    if (ctx.shared) return;
    const s = connect();
    setOwn(s);
    return () => {
      s?.disconnect();
    };
  }, [ctx.shared]);
  return ctx.shared ? ctx.socket : own;
}

/** Есть ли связь с сервером: «переподключение…» показываем, только когда её нет. */
export function useSocketLive(socket: Socket | null): boolean {
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!socket) return;
    const on = () => setLive(true);
    const off = () => setLive(false);
    setLive(socket.connected);
    socket.on('connect', on);
    socket.on('disconnect', off);
    return () => {
      socket.off('connect', on);
      socket.off('disconnect', off);
    };
  }, [socket]);
  return live;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Время в списке диалогов: «14:05» сегодня, «вчера», «12 окт.», «12.10.25». */
export function listTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'вчера';
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Разделитель дней в диалоге: «Сегодня», «Вчера», «12 октября». */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return 'Сегодня';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  created: 'ждёт оплаты',
  paid: 'оплачен',
  delivered: 'выдан',
  completed: 'завершён',
  disputed: 'спор',
  refunded: 'возврат',
  cancelled: 'отменён',
  expired: 'истёк',
};
