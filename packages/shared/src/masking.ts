/**
 * Маскирование контактов в чате (антискам, docs/05, docs/06).
 * Чистая функция без побочных эффектов → тестируемо. Цель — мешать уводу сделки
 * мимо эскроу: скрываем телефоны, email, ссылки, @ники и упоминания мессенджеров.
 */

const REPLACEMENT = '[скрыто]';

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
