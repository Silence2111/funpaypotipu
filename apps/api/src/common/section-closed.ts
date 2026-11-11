import { ConflictException } from '@nestjs/common';
import { CLOSED_REASON_DEFAULT, LISTING_IN_REVIEW, SECTION_CLOSED } from '@gamemarket/shared';

/**
 * Раздел закрыт для продажи (часть 122): 409 с кодом и причиной раздела —
 * сайт показывает её продавцу как есть, вместо «что-то пошло не так».
 */
export const sectionClosedError = (reason?: string | null) =>
  new ConflictException({
    statusCode: 409,
    message: reason || CLOSED_REASON_DEFAULT,
    error: SECTION_CLOSED,
  });

/** Лот на проверке: в продажу его возвращает модератор, не продавец. */
export const listingInReviewError = () =>
  new ConflictException({
    statusCode: 409,
    message: 'Лот на проверке у модератора: в продажу его вернёт модератор',
    error: LISTING_IN_REVIEW,
  });
