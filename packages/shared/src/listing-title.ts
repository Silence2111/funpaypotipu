/**
 * Чистая выдача (часть 143): название лота без шума. Раздел Playerok забит
 * «🧅АВТОВЫДАЧА🧅» и «!!!ДЁШЕВО!!!» — покупатель не видит, что продаётся.
 * Проверка — при создании и при смене названия; старые названия не трогаем,
 * пока продавец их не правит.
 *
 * Без zod: модуль идёт и в форму на сайте, и в API.
 */

/** Сколько эмодзи можно в названии: одно-два для акцента — да, гирлянда — нет. */
export const TITLE_EMOJI_MAX = 2;
/** Доля заглавных среди букв, выше которой название «кричит». */
export const TITLE_CAPS_MAX = 0.6;
/** С какой длины (в буквах) считаем заглавные: «AWP», «CS2 FN» — сокращения. */
export const TITLE_CAPS_MIN_LETTERS = 10;

const EMOJI = /\p{Extended_Pictographic}/gu;
const LETTER = /\p{L}/gu;
const UPPER = /\p{Lu}/u;
// Три и больше одинаковых знака подряд: «!!!», «???», «***», «$$$».
// Многоточие — обычный знак, его не считаем.
const REPEAT = /([!?*$#~=_+|•★☆✓✔-])\1{2,}/u;

export function titleEmojiCount(title: string): number {
  return title.match(EMOJI)?.length ?? 0;
}

/** Доля заглавных среди букв; букв меньше порога — 0. */
export function titleCapsShare(title: string): number {
  const letters = title.match(LETTER) ?? [];
  if (letters.length < TITLE_CAPS_MIN_LETTERS) return 0;
  return letters.filter((l) => UPPER.test(l)).length / letters.length;
}

/** Почему название не годится, или null. */
export function titleNoiseError(title: string): string | null {
  const t = title.trim();
  if (titleEmojiCount(t) > TITLE_EMOJI_MAX) return `В названии — не больше ${TITLE_EMOJI_MAX} эмодзи`;
  if (titleCapsShare(t) > TITLE_CAPS_MAX) return 'Название не заглавными буквами: так лот похож на спам';
  if (REPEAT.test(t)) return 'Без повторов знаков в названии: «!!!», «***»';
  return null;
}
