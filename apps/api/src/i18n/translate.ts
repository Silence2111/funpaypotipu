import { EN_SHARED, translateText, type Phrasebook } from '@gamemarket/shared';
import { EN_API } from './en';

const BOOK: Phrasebook = { ...EN_SHARED, ...EN_API };
const CYRILLIC = /[а-яё]/i;

/**
 * Русский текст ошибки по-английски; undefined — перевода нет. Русские
 * данные в кавычках («Ранг» в «Fill in “Ранг”») допустимы: это название из
 * базы. Русские слова вне кавычек значат, что сработал слишком общий
 * шаблон, — такой перевод хуже русского оригинала.
 */
export function toEnglish(text: string): string | undefined {
  if (!CYRILLIC.test(text)) return undefined;
  const en = translateText(BOOK, text);
  if (en === undefined) return undefined;
  return CYRILLIC.test(en.replace(/“[^”]*”/g, '')) ? undefined : en;
}

type Body = Record<string, unknown>;
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Тело ошибки на английском или null, если показать нечего: Nest кладёт
 * текст в message (строка или массив), ZodValidationPipe — в поля
 * `{ price: ['…'] }`. Остальные поля (statusCode, error-код, suggested…)
 * не трогаются. `lang: 'en'` — сайту: текст переведён, его можно показать.
 */
export function localizeErrorBody(response: string | object, status: number): Body | null {
  const body: Body =
    typeof response === 'string'
      ? { statusCode: status, message: response }
      : { ...(response as Body) };
  if ('message' in body) {
    const m = body.message;
    if (typeof m === 'string') {
      const en = toEnglish(m);
      if (en === undefined) return null;
      body.message = en;
    } else if (strings(m) && m.length) {
      const en = m.map(toEnglish);
      if (en[0] === undefined) return null;
      body.message = m.map((x, i) => en[i] ?? x);
    } else {
      return null;
    }
  } else {
    const fields = Object.entries(body);
    if (!fields.length || !fields.every(([, v]) => strings(v))) return null;
    let translated = false;
    for (const [k, v] of fields) {
      body[k] = (v as string[]).map((x) => {
        const en = toEnglish(x);
        if (en !== undefined) translated = true;
        return en ?? x;
      });
    }
    if (!translated) return null;
  }
  body.lang = 'en';
  return body;
}
