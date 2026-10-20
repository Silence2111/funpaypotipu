'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getToken } from './session';
import { RU, msg, type T } from './i18n/lang';

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
export function listTime(iso: string, now = new Date(), t: T = RU): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return d.toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return t('вчера');
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(t.locale, { day: 'numeric', month: 'short' });
  return d.toLocaleDateString(t.locale, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Разделитель дней в диалоге: «Сегодня», «Вчера», «12 октября». */
export function dayLabel(iso: string, now = new Date(), t: T = RU): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return t('Сегодня');
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return t('Вчера');
  return d.toLocaleDateString(t.locale, {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Статус заказа в шапке диалога и в списке; показывать через t(). */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  created: msg('ждёт оплаты'),
  paid: msg('оплачен'),
  delivered: msg('выдан'),
  completed: msg('завершён'),
  disputed: msg('спор'),
  refunded: msg('возврат'),
  cancelled: msg('отменён'),
  expired: msg('истёк'),
};

/**
 * Системные сообщения сделки (orders.service в API) приходят готовой
 * русской строкой. Здесь — их полный список: на английском сайте они
 * переводятся, неизвестные показываются как есть.
 */
const SYSTEM_MESSAGES = new Set([
  msg('Заказ создан. Обсудите детали и дождитесь оплаты.'),
  msg('Пришла ещё одна оплата, когда заказ уже был оплачен или закрыт, — она зачислена на баланс покупателя.'),
  msg('Оплата поступила — средства защищены эскроу.'),
  msg('Пополнение отправлено. Проверьте баланс и подтвердите получение.'),
  msg('Товар выдан автоматически — он на странице заказа. Проверьте его и подтвердите получение.'),
  msg('Товар выдан автоматически. Заберите ключ на странице заказа.'),
  msg('Провайдер не принял пополнение — деньги вернулись на баланс покупателя.'),
  msg('Товара не оказалось на складе — деньги вернулись на баланс покупателя.'),
  msg('Пока шла оплата, товар закончился — деньги вернулись на баланс покупателя.'),
  msg('Продавец отметил выдачу. Проверьте товар и подтвердите получение.'),
  msg('Срок проверки истёк — заказ подтверждён автоматически. Средства переданы продавцу.'),
  msg('Покупатель подтвердил получение. Сделка завершена, средства переданы продавцу.'),
  msg('Заказ отменён до оплаты.'),
  msg('Заказ отменён, средства возвращены покупателю на баланс.'),
  msg('Продавец вернул деньги покупателю на баланс.'),
  msg('Продавец не выдал товар в срок — заказ отменён автоматически, средства возвращены покупателю.'),
  msg('Открыт спор. К обсуждению подключится арбитр площадки.'),
  msg('Спор решён в пользу продавца. Средства переданы продавцу.'),
  msg('Спор решён в пользу покупателя. Средства возвращены покупателю.'),
]);

/** «25 000 золота» из системного сообщения → «25,000 gold». */
function qtyText(t: T, raw: string): string {
  const m = /^([\d\s\u00a0\u202f]+) (.+)$/.exec(raw);
  if (!m) return raw;
  return `${t.num(Number(m[1]!.replace(/\D/g, '')))} ${t.d(m[2]!)}`;
}

/** Системное сообщение на языке сайта: «Вопрос о лоте …», события сделки. */
export function systemText(t: T, body: string): string {
  if (t.lang === 'ru') return body;
  if (SYSTEM_MESSAGES.has(body)) return t(body);
  // i18n-ignore-start — так их пишет API
  const about = /^Вопрос о лоте «(.+)»$/s.exec(body);
  const qty = /^(.+?) Количество: (.+)\.$/s.exec(body);
  const why = /^(.+?) Причина: (.+)$/s.exec(body);
  // i18n-ignore-end
  if (about) return t('Вопрос о лоте «{title}»', { title: about[1]! });
  if (qty) return `${systemText(t, qty[1]!)} ${t('Количество: {qty}.', { qty: qtyText(t, qty[2]!) })}`;
  if (why) return `${systemText(t, why[1]!)} ${t('Причина: {reason}', { reason: why[2]! })}`;
  return body;
}

/** Последнее сообщение в списке диалогов: системное — переводом, вложение — подписью. */
export function previewText(t: T, last: { system: boolean; text: string }): string {
  if (last.system) return systemText(t, last.text);
  return last.text === 'Вложение' ? t('Вложение') : last.text; // i18n-ignore
}
