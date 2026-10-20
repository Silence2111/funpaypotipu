/**
 * Язык интерфейса. Тексты в коде — русские, как и были: русская фраза —
 * ключ, английская лежит в словаре `en/`. Так компонент читается как
 * раньше, а фразы без перевода находит проверка `scripts/i18n-check.mjs`.
 *
 * Словарь сюда не импортируется: на сервере его даёт `server.ts`, в браузер
 * он приходит от сервера только на английском — русский посетитель его не
 * скачивает.
 */
import { translateText } from '@gamemarket/shared/i18n';

export type Lang = 'ru' | 'en';

export const LANG_COOKIE = 'gm_lang';
export const LANG_NAMES: Record<Lang, string> = { ru: 'Русский', en: 'English' };

export type Vars = Record<string, string | number>;

export interface Dict {
  /** Фразы интерфейса. */
  phrases: Record<string, string>;
  /** Данные из базы и общих модулей. */
  data: Record<string, string>;
  /** Формы слов: русская форма для 1 → [one, other]. */
  plural: Record<string, readonly [string, string]>;
}

export const NO_DICT: Dict = { phrases: {}, data: {}, plural: {} };

/**
 * Язык без выбора: русский, если он есть среди языков браузера (или
 * украинский, белорусский, казахский — у нас покупают из СНГ), иначе
 * английский. Без заголовка — русский: так приходят поисковые роботы.
 */
export function preferredLang(acceptLanguage: string | null | undefined): Lang {
  if (!acceptLanguage?.trim()) return 'ru';
  return /(^|[\s,])(ru|uk|be|kk)\b/i.test(acceptLanguage) ? 'ru' : 'en';
}

export const isLang = (v: unknown): v is Lang => v === 'ru' || v === 'en';

const fill = (s: string, vars?: Vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

export interface T {
  /** Фраза на языке интерфейса; `{name}` подставляется из vars. */
  (ru: string, vars?: Vars): string;
  lang: Lang;
  /** Локаль чисел и дат: ru-RU или en-US. */
  locale: string;
  /** Число со словом: «3 продавца» / «3 sellers». */
  n(n: number, one: string, few: string, many: string): string;
  /** Слово без числа: «продавца» / «sellers». */
  word(n: number, one: string, few: string, many: string): string;
  /**
   * Данные из базы и общих модулей: названия разделов, параметры, единицы,
   * проверки («Минимум — 500 ₽»). Без перевода — как есть.
   */
  d(ru: string): string;
  /** Число по-русски «1 500», по-английски «1,500». */
  num(n: number): string;
}

export function makeT(lang: Lang, dict: Dict): T {
  const en = lang === 'en';
  const locale = en ? 'en-US' : 'ru-RU';
  const nf = new Intl.NumberFormat(locale);
  const word = (n: number, one: string, few: string, many: string) => {
    const forms = en ? dict.plural[one] : undefined;
    if (forms) return Math.abs(n) === 1 ? forms[0] : forms[1];
    const mod10 = n % 10;
    const mod100 = n % 100;
    return mod10 === 1 && mod100 !== 11
      ? one
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? few
        : many;
  };
  const t = ((ru: string, vars?: Vars) => fill(en ? (dict.phrases[ru] ?? ru) : ru, vars)) as T;
  t.lang = lang;
  t.locale = locale;
  t.word = word;
  t.n = (n, one, few, many) => `${nf.format(n)} ${word(n, one, few, many)}`;
  t.d = (ru) =>
    en ? (dict.data[ru] ?? dict.phrases[ru] ?? translateText(dict.data, ru) ?? ru) : ru;
  t.num = (n) => nf.format(n);
  return t;
}

/** Русский переводчик — значение по умолчанию для общих функций. */
export const RU: T = makeT('ru', NO_DICT);

/**
 * Помечает фразу для перевода там, где языка ещё нет — в константах модуля:
 * `const STATUS = { paid: msg('Оплачен') }`, а при показе — `t(STATUS[s])`.
 */
export const msg = (ru: string) => ru;

/** Язык страницы в браузере: его ставит сервер в `<html lang>`. */
export function documentLang(): Lang {
  return typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'ru';
}
