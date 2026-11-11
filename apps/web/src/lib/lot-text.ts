/**
 * Лот на английском (часть 144): англоязычному покупателю — название и
 * описание по-английски, если продавец их дал; нет — русские, как у FunPay.
 */
export const lotTitle = (l: { title: string; titleEn?: string | null }, lang: string) =>
  (lang === 'en' && l.titleEn) || l.title;

export const lotDescription = (l: { description: string; descriptionEn?: string | null }, lang: string) =>
  (lang === 'en' && l.descriptionEn) || l.description;
