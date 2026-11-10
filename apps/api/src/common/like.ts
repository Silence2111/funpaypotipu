/**
 * Поиск «содержит» в Prisma — это ILIKE, и «%» и «_» в тексте Prisma не
 * экранирует: «_» в нике совпадал с любой буквой, а «%» находил всё подряд.
 * Здесь они — обычные знаки.
 */
export const likeText = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Условие «содержит, без учёта регистра» для строкового поля. */
export const containsText = (text: string) => ({
  contains: likeText(text),
  mode: 'insensitive' as const,
});
