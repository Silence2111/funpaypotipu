import { SERVICE_TERM_DAYS } from '@gamemarket/shared/service-term';
import type { T } from './i18n/lang';

/** Срок услуги словами (часть 125): «3 дня» / «3 days». */
export const serviceTermText = (t: T, hours: number) => t.n(Math.round(hours / 24), 'день', 'дня', 'дней');

/** Варианты срока для формы лота: часы и подпись. */
export const serviceTermOptions = (t: T) => SERVICE_TERM_DAYS.map((d) => ({ hours: d * 24, label: serviceTermText(t, d * 24) }));
