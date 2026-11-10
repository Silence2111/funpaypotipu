import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { EN_DICT } from './en';
import {
  LANG_COOKIE,
  NO_DICT,
  isLang,
  makeT,
  preferredLang,
  type Dict,
  type Lang,
  type T,
} from './lang';

/** Язык запроса: выбранный на сайте (cookie), иначе — по языкам браузера. */
export const getLang = cache(async (): Promise<Lang> => {
  const chosen = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(chosen)) return chosen;
  return preferredLang((await headers()).get('accept-language'));
});

/** Словарь языка: для русского пустой — русские фразы и есть ключи. */
export const dictOf = (lang: Lang): Dict => (lang === 'en' ? EN_DICT : NO_DICT);

/** Переводчик для серверных компонентов: `const t = await getT()`. */
export async function getT(): Promise<T> {
  const lang = await getLang();
  return makeT(lang, dictOf(lang));
}
