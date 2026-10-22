/**
 * Загрузка лотов из таблицы: продавец выгружает из Excel или Google
 * Таблиц CSV — строка на лот, столбцы «Название», «Описание», «Цена»,
 * «Наличие» и характеристики раздела. Сайт разбирает файл и показывает
 * строки с ошибками до загрузки, API проверяет каждую строку той же
 * функцией и выставляет годные. Один раздел за раз, лоты целиком.
 */

/** Столько лотов за одну загрузку — больше разбивайте на несколько файлов. */
export const IMPORT_MAX_ROWS = 200;

/** Характеристика раздела, как её отдаёт `GET /catalog/categories/:id/attributes`. */
export interface ImportAttr {
  key: string;
  label: string;
  type: string;
  options?: string[] | null;
  isRequired: boolean;
}

/** Лот из строки таблицы, уже в виде запроса на создание. */
export interface ImportLot {
  /** Номер строки в файле: заголовок — первая. */
  line: number;
  title: string;
  description: string;
  /** Копейки строкой. */
  price: string;
  stock: number | null;
  attributes: Record<string, string | boolean>;
}

export interface ImportRead {
  lots: ImportLot[];
  /** Строки, которые выставить нельзя, с причиной. */
  errors: Array<{ line: number; message: string }>;
  /** Ошибка всей таблицы: нет нужного столбца, лишний столбец, слишком много строк. */
  fatal: string | null;
}

/**
 * CSV в таблицу. Разделитель — тот, которого больше в первой строке: Excel
 * с русскими настройками сохраняет через «;», Google Таблицы — через «,».
 * Кавычки и переносы внутри ячейки, удвоенные кавычки, BOM — как в RFC 4180.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const outside = firstLine.replace(/"[^"]*"/g, '');
  const counts = [';', ',', '\t'].map((d) => [d, outside.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const sep = best[1] > 0 ? best[0] : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const FIELDS: Record<'title' | 'description' | 'price' | 'stock', string[]> = {
  title: ['название', 'title'],
  description: ['описание', 'description'],
  price: ['цена', 'price'],
  stock: ['наличие', 'количество', 'stock'],
};

/** «Цена, ₽*» → «цена»: регистр, звёздочка обязательного и валюта не важны. */
const headerKey = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/\*$/, '')
    .replace(/,?\s*₽$/, '')
    .trim();

const YES = ['да', 'yes', 'true', '1', '+'];
const NO = ['нет', 'no', 'false', '0', '-'];

/** «1 500,50 ₽» → «150050» копеек; не цена — null. */
export function importPrice(raw: string): string | null {
  const v = raw.replace(/[\s ₽]/g, '').replace(',', '.');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return null;
  const minor = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return minor > 0n ? minor.toString() : null;
}

/**
 * Что не так с лотом из строки: та же проверка на сайте до загрузки и в
 * API перед созданием. null — лот можно выставлять.
 */
export function lotImportError(lot: ImportLot, attrs: ImportAttr[]): string | null {
  const title = lot.title.trim();
  if (title.length < 3 || title.length > 120) return 'Название — от 3 до 120 знаков';
  if (!lot.description.trim()) return 'Нет описания';
  if (lot.description.length > 10_000) return 'Описание — до 10 000 знаков';
  if (!/^\d+$/.test(lot.price) || BigInt(lot.price) <= 0n)
    return 'Цена — число больше нуля, например 490';
  if (
    lot.stock != null &&
    (!Number.isInteger(lot.stock) || lot.stock < 0 || lot.stock > 9_999_999)
  ) {
    return 'Наличие — целое число или пусто';
  }
  for (const a of attrs) {
    const v = lot.attributes[a.key];
    const empty = v === undefined || v === '';
    if (a.isRequired && empty) return `Укажите характеристику «${a.label}»`;
    if (!empty && a.type === 'enum' && a.options && !a.options.includes(String(v))) {
      return `Недопустимое значение «${a.label}»`;
    }
  }
  return null;
}

/** Таблица → лоты: столбцы по заголовкам, значения — в запрос, ошибки — по строкам. */
export function readImport(table: string[][], attrs: ImportAttr[]): ImportRead {
  const out: ImportRead = { lots: [], errors: [], fatal: null };
  const [header, ...body] = table;
  if (!header || !header.some((h) => h.trim())) {
    out.fatal = 'Пустой файл — нужна строка заголовков и строки лотов';
    return out;
  }
  type Column = { field: keyof typeof FIELDS } | { attr: ImportAttr };
  const columns: Array<Column | null> = [];
  for (const h of header) {
    const key = headerKey(h);
    if (!key) {
      columns.push(null);
      continue;
    }
    const field = (Object.keys(FIELDS) as Array<keyof typeof FIELDS>).find((f) =>
      FIELDS[f].includes(key),
    );
    const attr = attrs.find((a) => a.label.toLowerCase() === key || a.key.toLowerCase() === key);
    if (field) columns.push({ field });
    else if (attr) columns.push({ attr });
    else {
      out.fatal = `Неизвестный столбец «${h.trim()}» — уберите его или переименуйте`;
      return out;
    }
  }
  const need = {
    title: 'Нет столбца «Название»',
    description: 'Нет столбца «Описание»',
    price: 'Нет столбца «Цена»',
  };
  for (const [field, message] of Object.entries(need)) {
    if (!columns.some((c) => c && 'field' in c && c.field === field)) {
      out.fatal = message;
      return out;
    }
  }
  const rows = body
    .map((cells, i) => ({ cells, line: i + 2 }))
    .filter((r) => r.cells.some((c) => c.trim()));
  if (rows.length > IMPORT_MAX_ROWS) {
    out.fatal = `Не больше ${IMPORT_MAX_ROWS} лотов за раз — разделите таблицу`;
    return out;
  }
  for (const { cells, line } of rows) {
    const lot: ImportLot = {
      line,
      title: '',
      description: '',
      price: '',
      stock: null,
      attributes: {},
    };
    let problem: string | null = null;
    columns.forEach((c, i) => {
      const raw = (cells[i] ?? '').trim();
      if (!c || problem) return;
      if ('attr' in c) {
        if (!raw) return;
        const a = c.attr;
        if (a.type === 'bool') {
          const v = raw.toLowerCase();
          if (YES.includes(v)) lot.attributes[a.key] = true;
          else if (!NO.includes(v)) problem = `«${a.label}» — «да» или «нет»`;
        } else if (a.type === 'enum' && a.options) {
          lot.attributes[a.key] =
            a.options.find((o) => o.toLowerCase() === raw.toLowerCase()) ?? raw;
        } else {
          lot.attributes[a.key] = raw;
        }
        return;
      }
      if (c.field === 'title') lot.title = raw;
      else if (c.field === 'description') lot.description = (cells[i] ?? '').trim();
      else if (c.field === 'price') {
        const p = importPrice(raw);
        if (p) lot.price = p;
        else problem = 'Цена — число больше нуля, например 490';
      } else if (c.field === 'stock' && raw) {
        if (/^\d{1,7}$/.test(raw.replace(/[\s ]/g, '')))
          lot.stock = Number(raw.replace(/[\s ]/g, ''));
        else problem = 'Наличие — целое число или пусто';
      }
    });
    const message = problem ?? lotImportError(lot, attrs);
    if (message) out.errors.push({ line, message });
    else out.lots.push(lot);
  }
  if (!out.lots.length && !out.errors.length) out.fatal = 'В таблице нет строк с лотами';
  return out;
}

/** Строка заголовков для шаблона: основные столбцы и характеристики раздела, через «;». */
export function importTemplate(attrs: ImportAttr[], lang: 'ru' | 'en' = 'ru'): string {
  const base =
    lang === 'en'
      ? ['title', 'description', 'price', 'stock']
      : ['Название', 'Описание', 'Цена, ₽', 'Наличие'];
  const cols = [...base, ...attrs.map((a) => (lang === 'en' ? a.key : a.label))];
  return `${cols.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')}\r\n`;
}
