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
  '{subject}.\n\n{action}: {link}': '{subject}.\n\n{action}: {link}',
  '{subject}.\n\n{preview}\n\n{action}: {link}': '{subject}.\n\n{preview}\n\n{action}: {link}',
  Подробности: 'Details',
  'Сообщение от {name}': 'Message from {name}',
  'Уведомление GameMarket': 'GameMarket notification',

  // Письма входа
  'Подтвердите e-mail — GameMarket': 'Confirm your email — GameMarket',
  'Здравствуйте, {name}. Подтвердите e-mail: {link}\nПокупки защищены эскроу.':
    'Hello, {name}. Confirm your email: {link}\nPurchases are protected by escrow.',
  'Восстановление пароля — GameMarket': 'Password reset — GameMarket',
  'Сброс пароля (ссылка действует 1 час): {link}\nЕсли вы не запрашивали — проигнорируйте письмо.':
    'Reset your password (the link works for 1 hour): {link}\nIf you didn’t request this, ignore this email.',
  // Пароль изменён: превью уведомления и ссылка «Это не я» в письме
  'Пароль изменён: {device}, IP {ip}. Другие устройства вышли из аккаунта. Если это были не вы — восстановите доступ по ссылке «Это не я» из письма.':
    'Password changed: {device}, IP {ip}. Other devices have been signed out. If it wasn’t you, restore access with the “It wasn’t me” link in the email.',
  'Это не я — восстановить доступ': 'It wasn’t me — restore access',
  // Вход с кодом из приложения включён или выключен
  'Вход с кодом из приложения включён: {device}, IP {ip}. Если это были не вы — выключите его по ссылке «Это не я» из письма.':
    'Sign-in code turned on: {device}, IP {ip}. If it wasn’t you, turn it off with the “It wasn’t me” link in the email.',
  'Вход с кодом из приложения выключен: {device}, IP {ip}.':
    'Sign-in code turned off: {device}, IP {ip}.',
  'Это не я — выключить вход с кодом': 'It wasn’t me — turn off the sign-in code',
  // «Не могу войти»: заявка на восстановление доступа
  'Подана заявка на восстановление доступа к аккаунту: {device}. Если это не вы — отметьте «Заявку подал не я» в «Безопасности».':
    'An account recovery request was filed: {device}. If it wasn’t you, mark “I didn’t file this” in “Security”.',
  'Доступ к аккаунту восстановлен: вход с кодом выключен, вход через сервисы отвязан, все устройства вышли. Задайте новый пароль по ссылке из письма.':
    'Account access restored: the sign-in code is off, sign-in services are unlinked, and all devices are signed out. Set a new password with the link in the email.',
  'Задать новый пароль': 'Set a new password',
  'Подана заявка на восстановление доступа к аккаунту с просьбой сменить почту: {device}. Если это не вы — отметьте «Заявку подал не я» в «Безопасности».':
    'An account recovery request asking to change the email was filed: {device}. If it wasn’t you, mark “I didn’t file this” in “Security”.',
  'Восстановление доступа: загрузите документы — GameMarket':
    'Account recovery: upload your documents — GameMarket',
  'Сотрудник проверяет заявку на восстановление доступа. Загрузите фото документа и селфи с ним — тем же, что при проверке личности (ссылка действует неделю): {link}\nЕсли заявку подавали не вы — проигнорируйте письмо.':
    'Our staff are reviewing your account recovery request. Upload a photo of your ID and a selfie with it — the same document as in your ID check (the link works for a week): {link}\nIf you didn’t file this request, ignore this email.',
  'Почта аккаунта изменена — GameMarket': 'Account email changed — GameMarket',
  'Почта аккаунта GameMarket изменена на {email} по заявке на восстановление доступа: сотрудник сверил документы с проверкой личности. Если это не вы — ответьте на это письмо.':
    'Your GameMarket account email was changed to {email} after an account recovery request: our staff checked the documents against your ID check. If it wasn’t you, reply to this email.',
  'Почта аккаунта GameMarket изменена на {email} по заявке на восстановление доступа: сделки из заявки подтвердили их участники. Если это не вы — ответьте на это письмо.':
    'Your GameMarket account email was changed to {email} after an account recovery request: the other parties confirmed the deals described in it. If it wasn’t you, reply to this email.',
  'Почта аккаунта GameMarket изменена на {email} по заявке на восстановление доступа: заявитель заплатил картой, которой платили в аккаунте. Если это не вы — ответьте на это письмо.':
    'Your GameMarket account email was changed to {email} after an account recovery request: the requester paid with a card previously used in the account. If it wasn’t you, reply to this email.',
  'Восстановление доступа: проверка картой — GameMarket':
    'Account recovery: card check — GameMarket',
  'Сотрудник проверяет заявку на восстановление доступа. Заплатите 1 ₽ картой, которой вы платили на GameMarket или на которую выводили деньги: сумма только заблокируется и сразу вернётся (ссылка действует неделю): {link}\nЕсли заявку подавали не вы — проигнорируйте письмо.':
    'Our staff are reviewing your account recovery request. Pay 1 ₽ with a card you’ve paid with on GameMarket or withdrawn money to: the amount is only put on hold and released right away (the link works for a week): {link}\nIf you didn’t file this request, ignore this email.',
  'Подтвердите новую почту — GameMarket': 'Confirm your new email — GameMarket',
  'Чтобы сделать эту почту почтой аккаунта GameMarket, откройте ссылку (действует сутки): {link}\nЕсли вы ничего не меняли — проигнорируйте письмо.':
    'To make this the email of your GameMarket account, open the link (it works for a day): {link}\nIf you didn’t change anything, ignore this email.',
  'Почта аккаунта изменена на {email}: {device}, IP {ip}.':
    'The account email was changed to {email}: {device}, IP {ip}.',
  'Почту аккаунта GameMarket сменили на {email}: {device}, IP {ip}. Если это сделали не вы — верните прежнюю почту по ссылке (действует 7 дней): {link}\nВсе устройства выйдут из аккаунта, вход с кодом и входы через сервисы отключатся, пароль нужно будет задать новый.':
    'Your GameMarket account email was changed to {email}: {device}, IP {ip}. If it wasn’t you, restore the previous email with this link (it works for 7 days): {link}\nAll devices will be signed out, the sign-in code and service sign-ins will be turned off, and you’ll set a new password.',
  'Прежняя почта аккаунта возвращена по ссылке «Это не я»: пароль новый, все устройства вышли, вход с кодом и входы через сервисы отключены.':
    'The previous account email was restored with the “It wasn’t me” link: the password is new, all devices were signed out, and the sign-in code and service sign-ins were turned off.',
  'Восстановление доступа: опишите сделки — GameMarket':
    'Account recovery: describe your deals — GameMarket',
  'Сотрудник проверяет заявку на восстановление доступа. Проверки личности у аккаунта нет, поэтому опишите две-три сделки с разными продавцами или покупателями — мы спросим их, совпадает ли описание (ссылка действует неделю): {link}\nЕсли заявку подавали не вы — проигнорируйте письмо.':
    'Our staff are reviewing your account recovery request. The account has no ID check, so describe two or three deals with different sellers or buyers — we’ll ask them whether your description matches (the link works for a week): {link}\nIf you didn’t file this request, ignore this email.',
  '@{username}, с кем вы заключали сделки, восстанавливает доступ к аккаунту. Сверьте описание сделки — ответ увидит только сотрудник.':
    '@{username}, whom you’ve had deals with, is recovering their account. Check their description of the deal — only our staff will see your answer.',
  'Заявка на восстановление доступа отклонена: {note}':
    'The account recovery request was declined: {note}',

  // Сохранённые поиски: превью уведомления
  '«{title}» — {price}': '“{title}” — {price}',
  '«{title}» — {price} и ещё {n}': '“{title}” — {price} and {n} more',
  // Скидка у продавца из подписок
  '«{title}» — {price} вместо {old}': '“{title}” — {price} instead of {old}',
  '«{title}» — {price} вместо {old} и ещё {n}': '“{title}” — {price} instead of {old} and {n} more',
  // Подешевевший лот из избранного
  '«{title}»: было {old}, стало {new}': '“{title}”: was {old}, now {new}',
  // Вход с нового устройства
  'Вход с нового устройства: {device}, IP {ip}. Если это были не вы — завершите сеанс в «Безопасности» и смените пароль.':
    'Sign-in from a new device: {device}, IP {ip}. If it wasn’t you, end the session in “Security” and change your password.',
  // Оценка покупателя продавцом
  '{seller} рекомендует вас как покупателя': '{seller} recommends you as a buyer',
  '{seller} не рекомендует вас как покупателя': '{seller} doesn’t recommend you as a buyer',
  // Закончившийся лот снова в продаже
  '«{title}» снова в продаже': '“{title}” is back in stock',

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
