/** Формы слов (catalog): русская форма для 1 → [one, other]. */
export const PLURAL_CATALOG: Record<string, readonly [string, string]> = {
  // «· 12 отз.» в строке продавца — по-английски «· 12 reviews»
  'отз.': ['review', 'reviews'],
};
