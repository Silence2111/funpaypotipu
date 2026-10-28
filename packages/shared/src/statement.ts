import type { Minor } from './money';

/**
 * Выписка по балансу и выгрузки для Excel. Подписи операций общие для сайта
 * и файла: что продавец видит в кабинете, то и получает в выписке.
 */

/** Операция по refType проводки; неизвестное — «Операция», а не сырой ключ. */
export const LEDGER_OPERATIONS: Record<string, string> = {
  balance_topup: 'Пополнение баланса',
  order_payment_balance: 'Оплата заказа с баланса',
  order_payment: 'Оплата заказа',
  order_release: 'Зачисление за продажу',
  dispute_release: 'Зачисление по решению спора',
  cashback: 'Кэшбэк за покупку',
  order_refund: 'Возврат: заказ отменён',
  order_refund_overdue: 'Возврат: продавец не выдал товар',
  seller_refund: 'Возврат от продавца',
  dispute_refund: 'Возврат по решению спора',
  oos_refund: 'Возврат: товар закончился',
  late_payment: 'Повторная оплата заказа — на баланс',
  promotion: 'Продвижение лота',
  payout_hold: 'Заявка на вывод',
  payout_reverse: 'Заявка на вывод отклонена',
  payout_settle: 'Вывод средств',
};
export const OTHER_OPERATION = 'Операция';

export const operationLabel = (refType: string | null | undefined): string =>
  LEDGER_OPERATIONS[refType ?? ''] ?? OTHER_OPERATION;

/**
 * Фильтр выписки: операции по смыслу. Каждая операция — ровно в одной
 * группе, чтобы при фильтре ничего не терялось; неизвестные — только во «Всех».
 */
export const OPERATION_KINDS = [
  { key: 'sales', label: 'Продажи', refTypes: ['order_release', 'dispute_release'] },
  {
    key: 'purchases',
    label: 'Покупки',
    refTypes: ['order_payment_balance', 'order_payment', 'cashback'],
  },
  {
    key: 'refunds',
    label: 'Возвраты',
    refTypes: [
      'order_refund',
      'order_refund_overdue',
      'seller_refund',
      'dispute_refund',
      'oos_refund',
    ],
  },
  { key: 'topups', label: 'Пополнения', refTypes: ['balance_topup', 'late_payment'] },
  { key: 'payouts', label: 'Выводы', refTypes: ['payout_hold', 'payout_reverse', 'payout_settle'] },
  { key: 'promotion', label: 'Продвижение', refTypes: ['promotion'] },
] as const;

export type OperationKind = (typeof OPERATION_KINDS)[number]['key'];
export const OPERATION_KIND_KEYS = OPERATION_KINDS.map((k) => k.key) as [
  OperationKind,
  ...OperationKind[],
];

/** Операции группы — для условия выборки. */
export const operationKindRefTypes = (kind: OperationKind): readonly string[] =>
  OPERATION_KINDS.find((k) => k.key === kind)!.refTypes;

/** Время в выписке — московское: площадка и её продавцы живут по нему. */
export const MSK_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 86400_000;
/** Дольше года выписка не строится — для этого есть несколько выписок. */
export const MAX_PERIOD_DAYS = 366;

export interface Period {
  /** Начало — 00:00 по Москве первого дня. */
  from: Date;
  /** Конец — 00:00 по Москве дня после последнего (не включая). */
  to: Date;
  /** Те же даты ГГГГ-ММ-ДД — для имени файла и ответа. */
  fromDay: string;
  toDay: string;
}

/** «2026-10-21» по Москве. */
export const mskDay = (d: Date): string =>
  new Date(d.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);

const dayStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - MSK_OFFSET_MS);

/**
 * Период по датам из запроса; без дат — последние 30 дней. Ошибка — текстом
 * (его переводит API), а не исключением: модуль общий.
 */
export function parsePeriod(
  from: string | undefined,
  to: string | undefined,
  now = new Date(),
): Period | { error: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const toDay = to ?? mskDay(now);
  const fromDay = from ?? mskDay(new Date(dayStart(toDay).getTime() - 29 * DAY_MS));
  if (
    !re.test(fromDay) ||
    !re.test(toDay) ||
    isNaN(Date.parse(fromDay)) ||
    isNaN(Date.parse(toDay))
  ) {
    return { error: 'Даты — в виде ГГГГ-ММ-ДД' };
  }
  const start = dayStart(fromDay);
  const end = new Date(dayStart(toDay).getTime() + DAY_MS);
  if (start >= end) return { error: 'Начало периода позже конца' };
  if ((end.getTime() - start.getTime()) / DAY_MS > MAX_PERIOD_DAYS) {
    return { error: `Период — не больше ${MAX_PERIOD_DAYS} дней` };
  }
  return { from: start, to: end, fromDay, toDay };
}

/** Ячейка CSV: текст, число или готовое значение (сумма, дата) без экранирования. */
export type CsvCell = string | number | null | undefined | { raw: string };

/** Сумма для Excel: 1234,56 по-русски, 1234.56 по-английски, без пробелов. */
export function csvMoney(minor: Minor, lang: 'ru' | 'en'): { raw: string } {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const kop = (abs % 100n).toString().padStart(2, '0');
  return { raw: `${neg ? '-' : ''}${abs / 100n}${lang === 'ru' ? ',' : '.'}${kop}` };
}

/** Дата и время по Москве: «21.10.2026 09:15» или «2026-10-21 09:15» — Excel понимает обе. */
export function csvDate(d: Date, lang: 'ru' | 'en'): { raw: string } {
  const iso = new Date(d.getTime() + MSK_OFFSET_MS).toISOString();
  const [y, m, day] = [iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)];
  const time = iso.slice(11, 16);
  return { raw: lang === 'ru' ? `${day}.${m}.${y} ${time}` : `${y}-${m}-${day} ${time}` };
}

/**
 * CSV, который Excel открывает двойным щелчком: BOM для UTF-8, разделитель
 * «;» в русской выгрузке (запятая там — десятичный знак) и «,» в английской.
 * Текст, начинающийся с = + - @, Excel принял бы за формулу — такие ячейки
 * получают апостроф: название лота не выполнится как формула.
 */
export function toCsv(rows: CsvCell[][], lang: 'ru' | 'en'): string {
  const sep = lang === 'ru' ? ';' : ',';
  const cell = (v: CsvCell): string => {
    if (v == null) return '';
    if (typeof v === 'object') return v.raw;
    if (typeof v === 'number') return String(v);
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[";,\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `\uFEFF${rows.map((r) => r.map(cell).join(sep)).join('\r\n')}\r\n`;
}
