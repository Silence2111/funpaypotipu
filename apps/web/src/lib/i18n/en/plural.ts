/** Формы слов для t.n() и t.word(): русская форма для 1 → [one, other]. */
export const PLURAL: Record<string, readonly [string, string]> = {
  предложение: ['offer', 'offers'],
  раз: ['time', 'times'],
  сообщение: ['message', 'messages'],
  продавец: ['seller', 'sellers'],
  'шт.': ['pc', 'pcs'],
};
