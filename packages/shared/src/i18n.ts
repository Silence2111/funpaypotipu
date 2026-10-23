/**
 * Перевод готовых русских строк на английский — для текстов, которые
 * собираются вне интерфейса: проверки общих модулей («Минимум — 100 ₽»),
 * ошибки API, подписи уведомлений и способов оплаты.
 *
 * Словарь — русская фраза → английская. Фраза с подстановками
 * («Минимум — {sum}») переводит любую строку этого вида; подставленное
 * значение тоже переводится, если оно есть в словаре: «Минимум — 3 золота»
 * → «Minimum is 3 gold». Без перевода — undefined: решает вызывающий.
 */
export type Phrasebook = Record<string, string>;

/**
 * Язык по заголовку Accept-Language — одно правило для сайта и API:
 * русский, если он есть среди языков (или украинский, белорусский,
 * казахский — у нас покупают из СНГ), иначе английский. Без заголовка или
 * с «*» (так шлёт fetch в Node, так ходят роботы и вебхуки) — русский.
 */
export function preferredLang(header: string | string[] | null | undefined): 'ru' | 'en' {
  const tags = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((part) => part.split(';')[0]!.trim().toLowerCase())
    .filter((tag) => tag && tag !== '*');
  if (!tags.length) return 'ru';
  return tags.some((tag) => /^(ru|uk|be|kk)\b/.test(tag)) ? 'ru' : 'en';
}

interface Pattern {
  re: RegExp;
  names: string[];
  en: string;
  /** Длина постоянной части: «Минимум — от {sum}» точнее «Минимум — {sum}». */
  weight: number;
}

interface Compiled {
  exact: Map<string, string>;
  patterns: Pattern[];
}

const compiled = new WeakMap<Phrasebook, Compiled>();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(book: Phrasebook): Compiled {
  const exact = new Map<string, string>();
  const patterns: Pattern[] = [];
  for (const [ru, en] of Object.entries(book)) {
    if (!/\{\w+\}/.test(ru)) {
      exact.set(ru, en);
      continue;
    }
    const names: string[] = [];
    let weight = 0;
    const source = ru
      .split(/(\{\w+\})/)
      .map((part) => {
        const hole = /^\{(\w+)\}$/.exec(part);
        if (hole) {
          names.push(hole[1]!);
          return '(.+?)';
        }
        weight += part.length;
        return escape(part);
      })
      .join('');
    patterns.push({ re: new RegExp(`^${source}$`, 's'), names, en, weight });
  }
  patterns.sort((a, b) => b.weight - a.weight);
  return { exact, patterns };
}

export function translateText(book: Phrasebook, text: string, depth = 0): string | undefined {
  let c = compiled.get(book);
  if (!c) {
    c = compile(book);
    compiled.set(book, c);
  }
  const hit = c.exact.get(text);
  if (hit !== undefined) return hit;
  for (const p of c.patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    return p.en.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const i = p.names.indexOf(name);
      if (i < 0) return whole;
      const value = m[i + 1]!;
      return depth < 2 ? (translateText(book, value, depth + 1) ?? value) : value;
    });
  }
  return undefined;
}

/**
 * Строки общих модулей: способы оплаты и вывода, уровни продавца, проверки
 * пополнения, количества и данных покупателя, уведомления, замер выдачи.
 * Общие для сайта и API: одна строка — один перевод.
 */
export const EN_SHARED: Phrasebook = {
  // Оплата и вывод
  'С баланса': 'From balance',
  СБП: 'SBP (Faster Payments)',
  'Криптовалюта (USDT)': 'Crypto (USDT)',
  'Банковская карта': 'Bank card',
  ЮMoney: 'YooMoney',
  'Неизвестный способ оплаты: {key}': 'Unknown payment method: {key}',

  // Выписка по балансу: операции и период
  'Пополнение баланса': 'Balance top-up',
  'Оплата заказа с баланса': 'Order paid from balance',
  'Оплата заказа': 'Order payment',
  'Зачисление за продажу': 'Sale proceeds',
  'Зачисление по решению спора': 'Credited by dispute decision',
  'Кэшбэк за покупку': 'Purchase cashback',
  'Возврат: заказ отменён': 'Refund: order cancelled',
  'Возврат: продавец не выдал товар': 'Refund: the seller didn’t deliver',
  'Возврат от продавца': 'Refund from the seller',
  'Возврат по решению спора': 'Refund by dispute decision',
  'Возврат: товар закончился': 'Refund: out of stock',
  'Повторная оплата заказа — на баланс': 'Repeat order payment — credited to balance',
  'Продвижение лота': 'Listing promotion',
  'Заявка на вывод': 'Withdrawal request',
  'Заявка на вывод отклонена': 'Withdrawal request rejected',
  'Вывод средств': 'Withdrawal',
  Операция: 'Transaction',
  'Даты — в виде ГГГГ-ММ-ДД': 'Dates must look like YYYY-MM-DD',
  'Начало периода позже конца': 'The period starts after it ends',
  'Период — не больше {n} дней': 'The period can be at most {n} days',

  // Сообщения площадки в споре
  'Арбитр ждёт пояснений от продавца.': 'The arbiter is waiting for the seller’s explanation.',
  'Арбитр ждёт пояснений от покупателя.': 'The arbiter is waiting for the buyer’s explanation.',
  'Продавец не ответил в срок — арбитр учтёт это при решении.':
    'The seller didn’t reply in time — the arbiter will take this into account.',
  'Покупатель не ответил в срок — арбитр учтёт это при решении.':
    'The buyer didn’t reply in time — the arbiter will take this into account.',
  'Покупатель закрыл спор: претензий нет. Деньги переданы продавцу.':
    'The buyer closed the dispute with no claims. The money went to the seller.',
  'Продавец вернул деньги покупателю. Спор закрыт.':
    'The seller refunded the buyer. The dispute is closed.',

  // Уровни продавца
  Новичок: 'Newcomer',
  Проверенный: 'Trusted',
  'Pro-продавец': 'Pro seller',

  // Пополнение на сумму покупателя
  'Укажите сумму пополнения': 'Enter the top-up amount',
  'Сумма — целое число рублей': 'The amount must be a whole number of rubles',
  'Минимум — {sum}': 'Minimum is {sum}',
  'Максимум — {sum}': 'Maximum is {sum}',
  'Минимум — от {sum}': 'Minimum must be at least {sum}',
  'Максимум — не больше {sum}': 'Maximum can’t exceed {sum}',
  'Наценка задаётся в базисных пунктах, целым числом':
    'Markup is set in basis points, as a whole number',
  'Наценка не может быть отрицательной': 'Markup can’t be negative',
  'Наценка — не больше {pct}': 'Markup can’t exceed {pct}',
  'Границы суммы — целые рубли': 'Amount limits must be whole rubles',
  'Минимум больше максимума': 'Minimum is greater than maximum',
  'Логин Steam': 'Steam login',
  'Например, gamer_2007': 'For example, gamer_2007',
  'Логин для входа в Steam, не имя профиля':
    'The login you use to sign in to Steam, not your profile name',
  'Игровой ID или логин': 'Game ID or login',
  'Например, 812345678': 'For example, 812345678',
  'Пополнение придёт на этот аккаунт': 'The top-up will go to this account',
  'Укажите логин Steam': 'Enter your Steam login',
  'Укажите игровой ID или логин': 'Enter your game ID or login',
  'Слишком длинный ID': 'ID is too long',
  'Нужен логин Steam, а не почта': 'Enter your Steam login, not an email',
  'В логине Steam нет пробелов — похоже, это имя профиля':
    'Steam logins have no spaces — this looks like a profile name',
  'Логин Steam пишется латиницей': 'Steam logins use Latin characters',
  'Логин Steam — от 3 символов': 'Steam login must be at least 3 characters',
  'Логин Steam — не длиннее 64 символов': 'Steam login must be at most 64 characters',

  // Количество
  'Укажите количество': 'Enter a quantity',
  'Слишком большое количество': 'Quantity is too large',
  'В наличии только {n} {unit}': 'Only {n} {unit} in stock',
  'Лот закончился': 'Out of stock',
  'Минимум — {n} {unit}': 'Minimum is {n} {unit}',
  'Укажите единицу: например, «золото» или «шт.»': 'Enter a unit, for example “gold” or “pcs”',
  'Единица — не длиннее 24 символов': 'Unit must be at most 24 characters',
  'Цену можно указать за 1, 10, 100, 1 000, 10 000, 100 000 или 1 000 000 единиц':
    'Price can be set per 1, 10, 100, 1,000, 10,000, 100,000 or 1,000,000 units',
  'Минимум за заказ — от 1': 'Minimum per order is 1',
  'Укажите, на сколько процентов изменить цену': 'Enter by how many percent to change the price',
  'Цену можно изменить от −{min}% до +{max}%': 'The price can be changed from −{min}% to +{max}%',
  'Не больше {n} ступеней скидки': 'No more than {n} discount tiers',
  'Укажите, от какого количества скидка': 'Enter the quantity the discount starts from',
  'Скидка — от количества больше минимума за заказ':
    'The discount must start above the minimum per order',
  'Скидка за количество — от {min} до {max}%': 'A quantity discount is from {min} to {max}%',
  'Чем больше количество, тем больше скидка: ступени — по возрастанию':
    'The larger the quantity, the larger the discount: list tiers in ascending order',
  'Слишком большой минимум': 'Minimum is too large',
  'Укажите наличие': 'Enter the stock',
  'Наличие — целое число, от нуля': 'Stock must be a whole number, zero or more',
  'шт.': 'pcs',

  // Данные покупателя
  'Укажите «{label}»': 'Fill in “{label}”',
  '«{label}» — не длиннее {n} символов': '“{label}” must be at most {n} characters',

  // Проверки форм
  'только строчные латинские буквы, цифры и _': 'only lowercase Latin letters, digits and _',
  'Это имя занято': 'This name is taken',
  'ожидается целое число минорных единиц': 'expected a whole number of minor units',
  'Название поля — от 2 символов': 'Field name must be at least 2 characters',
  'Не больше трёх полей': 'No more than three fields',
  'Названия полей не должны повторяться': 'Field names must not repeat',
  'Сообщение — до 2000 знаков': 'Message must be up to 2,000 characters',

  // Уведомления: группы
  Заказы: 'Orders',
  'оплата, выдача, подтверждение, возвраты': 'payment, delivery, confirmation, refunds',
  Сообщения: 'Messages',
  'новые сообщения в чатах': 'new chat messages',
  Споры: 'Disputes',
  'открыт спор, ждём вашего ответа, решение арбитра':
    'dispute opened, your reply needed, arbiter’s decision',
  Отзывы: 'Reviews',
  'новый отзыв, ответ продавца, оценка вас как покупателя': 'new review, seller’s reply, a rating of you as a buyer',
  Деньги: 'Money',
  'кэшбэк и выплаты': 'cashback and payouts',
  Поддержка: 'Support',
  'ответы на ваши обращения': 'replies to your requests',
  'Поиски, избранное и подписки': 'Searches, favorites and follows',
  'новые предложения по сохранённым поискам, снижение цены в избранном, поступление закончившихся лотов, новые лоты и скидки продавцов, на которых вы подписаны':
    'new offers for saved searches, price drops in favorites, sold-out listings back in stock, new listings and discounts from sellers you follow',
  'Решения модерации': 'Moderation decisions',
  'жалобы, блокировки, проверка документов — письмом всегда':
    'reports, blocks, ID checks — always by email',

  // Уведомления: события
  'Новый заказ по вашему лоту': 'New order for your listing',
  'Заказ оплачен — выдайте товар': 'Order paid — deliver the goods',
  'Товар выдан — подтвердите получение': 'Goods delivered — confirm receipt',
  'Сделка завершена, деньги зачислены': 'Deal completed, money credited',
  'Заказ отменён': 'Order cancelled',
  'Возврат по заказу': 'Order refunded',
  'Повторная оплата заказа зачислена на баланс':
    'Repeat payment for the order credited to your balance',
  'Склад лота опустел — заказ возвращён': 'Listing ran out of stock — order refunded',
  'Новый отзыв': 'New review',
  'Продавец ответил на ваш отзыв': 'The seller replied to your review',
  'Кэшбэк за покупку зачислен на баланс': 'Purchase cashback credited to your balance',
  'Новое сообщение': 'New message',
  'Спор по сделке': 'Dispute on a deal',
  'Ждём вашего ответа в споре': 'Your reply is needed in a dispute',
  'Спор разрешён': 'Dispute resolved',
  'Ваша жалоба рассмотрена': 'Your report has been reviewed',
  'Лот заблокирован модератором': 'Listing blocked by a moderator',
  'Блокировка лота снята': 'Listing unblocked',
  'Статус аккаунта изменён': 'Account status changed',
  'Документы проверены — вывод без ограничения суммы': 'ID verified — withdrawals without a limit',
  'Документы не приняты — посмотрите причину': 'ID not accepted — see the reason',
  'Выплата отправлена': 'Payout sent',
  'Выплата отклонена': 'Payout rejected',
  'Поддержка ответила на обращение': 'Support replied to your request',
  'Новые предложения по сохранённому поиску': 'New offers for your saved search',
  'Лот из избранного подешевел': 'A listing in your favorites got cheaper',
  'Лот снова в продаже': 'A listing is back in stock',
  'Продавец оценил вас как покупателя': 'A seller rated you as a buyer',
  'Вход в аккаунт с нового устройства': 'Sign-in from a new device',
  Безопасность: 'Security',
  'вход с нового устройства, смена пароля и входа с кодом, восстановление доступа — письмом всегда':
    'sign-in from a new device, password and sign-in code changes, account recovery — always by email',
  'Заявка на восстановление доступа': 'Account recovery request',
  'Доступ к аккаунту восстановлен': 'Account access restored',
  'Заявка на восстановление отклонена': 'Account recovery request declined',
  'Пароль изменён': 'Password changed',
  'Вход с кодом из приложения включён': 'Sign-in code turned on',
  'Вход с кодом из приложения выключен': 'Sign-in code turned off',
  'Новые лоты у продавца из подписок': 'New listings from a seller you follow',
  'Скидка у продавца из подписок': 'A discount from a seller you follow',
  // Промокод продавца
  'Код — 4–20 латинских букв и цифр': 'A code must be 4–20 Latin letters and digits',

  // Замер выдачи («Как мы меряем выдачу»)
  'Замер невозможен: {reason} Нужно не меньше {a} чистых и {b} проблемных заказов (спор или возврат), чтобы назвать направление, и по {c} — чтобы утверждать разницу в 10 пунктов.':
    'Can’t measure: {reason} We need at least {a} clean and {b} problem orders (dispute or refund) to name a direction, and {c} of each to claim a 10-point difference.',
  'в базе только демонстрационные заказы — на них меряется генератор сида, а не выдача.':
    'the database has only demo orders — they would measure the seed generator, not the ranking.',
  'заказов с известным исходом — 0 (всего {n}).': 'orders with a known outcome — 0 (of {n} total).',
  'чистых заказов {clean}, проблемных {problem}.':
    '{clean} clean orders, {problem} problem orders.',
  'ни в одной категории не встретились чистый и проблемный заказ одновременно.':
    'no category has both a clean and a problem order.',
  'Исходов реже встречающегося класса {n} из {need}, нужных для утверждения разницы в 10 пунктов.':
    '{n} of the {need} outcomes of the rarer class needed to claim a 10-point difference.',
  'Посчитано, но сравнивать не с чем.': 'Calculated, but there is nothing to compare with.',
  'посчитано на настоящих данных.': 'calculated on real data.',
  '«{ours}» лучше лучшего тривиального правила «{trivial}» на {d} пункта ({a} против {b}).':
    '“{ours}” beats the best trivial rule “{trivial}” by {d} points ({a} vs {b}).',
  '«{ours}» хуже лучшего тривиального правила «{trivial}» на {d} пункта ({a} против {b}).':
    '“{ours}” is worse than the best trivial rule “{trivial}” by {d} points ({a} vs {b}).',
  '«{ours}» лучше лучшего тривиального правила «{trivial}» на {d} пункта ({a} против {b}). Данных мало: разница внутри погрешности.':
    '“{ours}” beats the best trivial rule “{trivial}” by {d} points ({a} vs {b}). Too little data: the difference is within the margin of error.',
  '«{ours}» хуже лучшего тривиального правила «{trivial}» на {d} пункта ({a} против {b}). Данных мало: разница внутри погрешности.':
    '“{ours}” is worse than the best trivial rule “{trivial}” by {d} points ({a} vs {b}). Too little data: the difference is within the margin of error.',
  // Загрузка лотов из таблицы (lot-import.ts)
  'Название — от 3 до 120 знаков': 'The title must be 3 to 120 characters',
  'Нет описания': 'No description',
  'Описание — до 10 000 знаков': 'The description must be up to 10,000 characters',
  'Цена — число больше нуля, например 490': 'The price must be a number above zero, for example 490',
  'Наличие — целое число или пусто': 'Stock must be a whole number or empty',
  'Укажите характеристику «{label}»': 'Fill in “{label}”',
  'Недопустимое значение «{label}»': 'Invalid value for “{label}”',
  '«{label}» — «да» или «нет»': '“{label}” must be “yes” or “no”',
  'Пустой файл — нужна строка заголовков и строки лотов': 'The file is empty — it needs a header row and rows of listings',
  'Неизвестный столбец «{name}» — уберите его или переименуйте': 'Unknown column “{name}” — remove or rename it',
  'Нет столбца «Название»': 'No “title” column',
  'Нет столбца «Описание»': 'No “description” column',
  'Нет столбца «Цена»': 'No “price” column',
  'Не больше {n} лотов за раз — разделите таблицу': 'No more than {n} listings at once — split the table',
  'В таблице нет строк с лотами': 'The table has no rows with listings',
  'Неверный ID — оставьте его как в выгрузке или очистите': 'Invalid ID — keep it as exported or clear it',
  'Этот лот уже есть в таблице выше': 'This listing is already in the table above',
  как_сейчас_новые_первыми: 'as_now_newest_first',
  дешевле_сверху: 'cheapest_first',
  по_сделкам_продавца: 'by_seller_deals',
  надёжность_продавца: 'seller_reliability',
};
