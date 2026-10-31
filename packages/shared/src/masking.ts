/**
 * Маскирование контактов в чате (антискам, docs/05, docs/06).
 * Чистая функция без побочных эффектов → тестируемо. Цель — мешать уводу сделки
 * мимо эскроу: скрываем телефоны, email, ссылки, @ники и упоминания мессенджеров.
 */

/** Чем заменяется скрытый контакт. Сайт и уведомления показывают метку на языке человека. */
export const HIDDEN_MARK = '[скрыто]';
const REPLACEMENT = HIDDEN_MARK;

const PATTERNS: RegExp[] = [
  // email
  /[\p{L}\d.+_-]+@[\p{L}\d-]+\.[\p{L}\d.-]+/giu,
  // ссылки
  /\b(?:https?:\/\/|www\.)\S+/giu,
  /\b[\p{L}\d-]+\.(?:ru|com|net|org|io|me|tg|xyz)\b/giu,
  // телефоны: 7+ цифр с возможными разделителями
  /\+?\d(?:[\d\s()-]{5,})\d/gu,
  // @ники (3+ символа)
  /@[\p{L}\d_]{3,}/giu,
  // мессенджеры/призывы увести общение (unicode-aware границы — \b не дружит с кириллицей)
  /(?<![\p{L}\d])(?:telegram|телеграм|телега|тг|whats?app|ватс?ап|вайбер|viber|discord|дискорд|скайп|skype)(?![\p{L}\d])/giu,
];

export interface MaskResult {
  masked: string;
  flagged: boolean;
}

/** Возвращает текст с заменёнными контактами и флаг, были ли замены. */
export function maskContacts(text: string): MaskResult {
  let masked = text;
  let flagged = false;
  for (const re of PATTERNS) {
    masked = masked.replace(re, () => {
      flagged = true;
      return REPLACEMENT;
    });
  }
  return { masked, flagged };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Как maskContacts, но не трогает ники участников диалога: «stb73721881»
 * похож на телефон, «telegram_fan» — на мессенджер, а это ники на площадке,
 * их и так видно в профиле. Ник, который целиком и есть контакт (одни
 * цифры, «telegram»), скрывается как обычно.
 */
export function maskContactsExcept(text: string, names: string[]): MaskResult {
  const keep = names
    .filter((n) => n && maskContacts(n).masked !== REPLACEMENT)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe);
  if (!keep.length) return maskContacts(text);
  // Ник — отдельным словом: не часть @ника, почты или ссылки («@seller_tg»
  // при собеседнике seller скрывается). Точка в конце фразы — можно.
  const re = new RegExp(
    `(?<![@\\p{L}\\d_./:])(${keep.join('|')})(?![\\p{L}\\d_@]|\\.[\\p{L}\\d])`,
    'giu',
  );
  let flagged = false;
  // split с группой: на нечётных местах — сами ники, они остаются как есть.
  const masked = text
    .split(re)
    .map((part, i) => {
      if (i % 2) return part;
      const r = maskContacts(part);
      flagged ||= r.flagged;
      return r.masked;
    })
    .join('');
  return { masked, flagged };
}
