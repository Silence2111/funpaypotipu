import { HIDDEN_MARK } from '@gamemarket/shared';
import type { T } from './i18n/lang';

/**
 * Текст, который написал человек, — как написан; только метка скрытого
 * контакта, которую API вписывает по-русски, — на языке сайта.
 */
export function userText(t: T, text: string): string {
  if (t.lang === 'ru' || !text.includes(HIDDEN_MARK)) return text;
  return text.split(HIDDEN_MARK).join(t('[скрыто]'));
}
