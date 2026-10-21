import { EN_SHARED, NOTIFY_LABELS, translateText } from '@gamemarket/shared';
import type { Lang } from './lang';

/**
 * Тексты, которые сервер пишет сам, а не страница: письма, сообщения бота
 * Telegram, пуши. Язык — users.locale получателя (последний язык сайта при
 * входе или выбранный в переключателе); бот без привязки — язык Telegram.
 *
 * Новая фраза в say() без перевода роняет test/i18n-texts.test.ts.
 */
export const EN_TEXTS: Record<string, string> = {
  // Выгрузки для Excel: выписка, продажи, сводка площадки
  'Дата (МСК)': 'Date (Moscow time)',
  Операция: 'Transaction',
  Заказ: 'Order',
  Приход: 'In',
  Расход: 'Out',
  Остаток: 'Balance',
  'Остаток на начало': 'Opening balance',
  Поступило: 'Total in',
  Списано: 'Total out',
  'Остаток на конец': 'Closing balance',
  'Дата зачисления (МСК)': 'Credited on (Moscow time)',
  Лот: 'Listing',
  Покупатель: 'Buyer',
  Количество: 'Quantity',
  'Оплатил покупатель': 'Paid by buyer',
  'Комиссия площадки': 'Marketplace fee',
  'Зачислено вам': 'Credited to you',
  Итого: 'Total',
  День: 'Day',
  'Сделок завершено': 'Deals completed',
  Оборот: 'Turnover',
  'Доход площадки': 'Marketplace revenue',

  // Темы писем об уведомлениях
  'Новый оплаченный заказ': 'New paid order',
  'Товар по заказу выдан': 'Your order has been delivered',
  'Возврат по заказу': 'Order refunded',
  'Оплата зачислена на баланс': 'Payment credited to your balance',
  'Лот заблокирован модератором': 'Listing blocked by a moderator',
  'Статус вашего аккаунта изменён': 'Your account status has changed',
  'Выплата отправлена': 'Payout sent',
  'Заявка на вывод отклонена': 'Withdrawal request rejected',
  'Открыт спор по вашей сделке': 'A dispute has been opened on your deal',
  'Ждём вашего ответа в споре': 'Your reply is needed in a dispute',
  'Спор по сделке разрешён': 'The dispute on your deal has been resolved',
  'Вы получили новый отзыв': 'You received a new review',

  // Письма, пуши и Telegram об уведомлениях
  '{subject}.\n\nПодробности: {link}': '{subject}.\n\nDetails: {link}',
  'Сообщение от {name}': 'Message from {name}',
  'Уведомление GameMarket': 'GameMarket notification',

  // Письма входа
  'Подтвердите e-mail — GameMarket': 'Confirm your email — GameMarket',
  'Здравствуйте, {name}. Подтвердите e-mail: {link}\nПокупки защищены эскроу.':
    'Hello, {name}. Confirm your email: {link}\nPurchases are protected by escrow.',
  'Восстановление пароля — GameMarket': 'Password reset — GameMarket',
  'Сброс пароля (ссылка действует 1 час): {link}\nЕсли вы не запрашивали — проигнорируйте письмо.':
    'Reset your password (the link works for 1 hour): {link}\nIf you didn’t request this, ignore this email.',
  'Пароль изменён': 'Password changed',
  'Пароль от GameMarket изменён, другие устройства вышли из аккаунта. Если это были не вы — восстановите доступ через «Забыли пароль».':
    'Your GameMarket password has been changed, and other devices have been signed out. If this wasn’t you, restore access with “Forgot password”.',

  // Сохранённые поиски: превью уведомления
  '«{title}» — {price}': '“{title}” — {price}',
  '«{title}» — {price} и ещё {n}': '“{title}” — {price} and {n} more',

  // Бот Telegram
  'Уведомления отключены. Подключить снова — в настройках профиля на сайте.':
    'Notifications are off. To turn them back on, go to Settings on the site.',
  'Это бот уведомлений GameMarket. Чтобы подключить его, откройте на сайте Профиль → Уведомления и нажмите «Подключить Telegram».':
    'This is the GameMarket notifications bot. To connect it, open Settings → Notifications on the site and tap “Connect Telegram”.',
  'Ссылка устарела. Нажмите «Подключить Telegram» в настройках на сайте ещё раз.':
    'The link has expired. Tap “Connect Telegram” in Settings on the site again.',
  'Этот Telegram уже подключён к другому аккаунту GameMarket. Отключите его там — командой /stop или в настройках.':
    'This Telegram is already connected to another GameMarket account. Disconnect it there — with /stop or in Settings.',
  'Аккаунт не найден.': 'Account not found.',
  'Готово: уведомления GameMarket будут приходить сюда. Отключить — командой /stop или в настройках на сайте.':
    'Done: GameMarket notifications will arrive here. To turn them off, send /stop or use Settings on the site.',
};

export type Vars = Record<string, string | number>;

const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

/** Фраза на языке получателя; `{name}` подставляется из vars. */
export function say(lang: Lang, ru: string, vars?: Vars): string {
  return fill(lang === 'en' ? (EN_TEXTS[ru] ?? ru) : ru, vars);
}

/** Подпись уведомления — та же, что в колокольчике на сайте. */
export function notifyLabel(lang: Lang, type: string): string | undefined {
  const ru = NOTIFY_LABELS[type];
  if (!ru || lang === 'ru') return ru;
  return translateText(EN_SHARED, ru) ?? ru;
}

/** Язык из users.locale: всё, кроме en, — русский. */
export const langOf = (locale: string | null | undefined): Lang => (locale === 'en' ? 'en' : 'ru');
