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
  'открыт спор, решение арбитра': 'dispute opened, arbiter’s decision',
  Отзывы: 'Reviews',
  'новый отзыв, ответ продавца': 'new review, seller’s reply',
  Деньги: 'Money',
  'кэшбэк и выплаты': 'cashback and payouts',
  Поддержка: 'Support',
  'ответы на ваши обращения': 'replies to your requests',
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
  как_сейчас_новые_первыми: 'as_now_newest_first',
  дешевле_сверху: 'cheapest_first',
  по_сделкам_продавца: 'by_seller_deals',
  надёжность_продавца: 'seller_reliability',
};
