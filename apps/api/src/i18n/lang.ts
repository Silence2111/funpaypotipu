/**
 * Язык ответа API. Сайт присылает свой язык в Accept-Language («ru» или
 * «en»); у остальных клиентов — заголовок браузера. Правило общее с сайтом
 * (preferredLang в @gamemarket/shared): русский, если он есть среди
 * языков, иначе английский; без заголовка или с «*» — русский.
 */
import { preferredLang } from '@gamemarket/shared';

export type Lang = 'ru' | 'en';

export const requestLang = (acceptLanguage: string | string[] | null | undefined): Lang =>
  preferredLang(acceptLanguage);
