import { NO_WARRANTY_SEGMENTS, WARRANTY_DAYS } from '@gamemarket/shared/warranty';
import type { T } from './i18n/lang';

/** Гарантия словами (часть 126): «7 дней» / «7 days». */
export const warrantyText = (t: T, days: number) => t.n(days, 'день', 'дня', 'дней');

/** Варианты гарантии для формы лота. */
export const warrantyOptions = (t: T) => WARRANTY_DAYS.map((d) => ({ days: d, label: warrantyText(t, d) }));

/** Даёт ли раздел гарантию: у валюты и пополнений её нет. */
export const warrantyAllowed = (c: { segment?: string; fulfillmentType: string } | undefined) =>
  !!c && c.fulfillmentType !== 'provider' && !!c.segment && !(NO_WARRANTY_SEGMENTS as readonly string[]).includes(c.segment);
