'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { LANG_COOKIE, RU, makeT, type Dict, type Lang, type T } from './lang';

const TContext = createContext<T>(RU);

/**
 * Язык и словарь от сервера — всем клиентским компонентам. Словарь приходит
 * только на английском: на русском он пустой.
 */
export function LangProvider({
  lang,
  dict,
  children,
}: {
  lang: Lang;
  dict: Dict;
  children: ReactNode;
}) {
  const t = useMemo(() => makeT(lang, dict), [lang, dict]);
  return <TContext.Provider value={t}>{children}</TContext.Provider>;
}

/** Переводчик для клиентских компонентов: `const t = useT()`. */
export const useT = (): T => useContext(TContext);

/** Запомнить выбор на год; страницу перерисовывает вызывающий (router.refresh). */
export function saveLang(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.lang = lang;
}
