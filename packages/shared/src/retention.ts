/**
 * Сроки хранения и уничтожение персональных данных (часть 147).
 *
 * - Переписка по сделкам удалённых аккаунтов — 3 года: срок исковой
 *   давности (ГК РФ ст. 196), дальше спорить не о чем.
 * - Сделки и движение денег — не меньше 5 лет после года сделки (402-ФЗ
 *   ст. 29, НК РФ ст. 23 п. 1 пп. 8). После — из сделок удалённых аккаунтов
 *   уничтожаются данные для выдачи и выданное; суммы в учёте остаются, но
 *   без персональных данных: аккаунт к этому времени уже обезличен.
 * - Каждое уничтожение — запись в журнал и акт (приказ Роскомнадзора от
 *   28.10.2022 № 179); акты и выгрузки из журнала хранятся 3 года.
 */

export const CHAT_RETENTION_YEARS = 3;
export const DEAL_RETENTION_YEARS = 5;
export const ACT_RETENTION_YEARS = 3;

/** Переписка, последнее сообщение в которой раньше этого, — к уничтожению. */
export function chatCutoff(now: Date): Date {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - CHAT_RETENTION_YEARS);
  return d;
}

/**
 * Сделки, созданные раньше этого, хранились 5 полных лет после года сделки:
 * сделка 2020 года хранится до конца 2025-го, с 1 января 2026-го — к уничтожению.
 */
export function dealCutoff(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear() - DEAL_RETENTION_YEARS, 0, 1));
}

/** Акты раньше этого удаляются вместе с журналом. */
export function actCutoff(now: Date): Date {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - ACT_RETENTION_YEARS);
  return d;
}

export type ErasureReason = 'account_deleted' | 'consent_revoked' | 'chat_retention' | 'deal_retention';

/** Причина уничтожения — в акте и выгрузке, с основанием. */
export const ERASURE_REASONS: Record<ErasureReason, string> = {
  account_deleted: 'Аккаунт удалён по просьбе пользователя, 30 дней на восстановление прошли (152-ФЗ ст. 21 ч. 4–5)',
  consent_revoked: 'Согласие на обработку отозвано и не дано снова за 30 дней (152-ФЗ ст. 21 ч. 5)',
  chat_retention: 'Истёк срок исковой давности по сделкам удалённого аккаунта — 3 года (ГК РФ ст. 196)',
  deal_retention: 'Истёк срок хранения документов по сделкам удалённого аккаунта — 5 лет после года сделки (402-ФЗ ст. 29, НК РФ ст. 23)',
};

/** Категории персональных данных — как в акте. */
export const ERASURE_CATEGORIES = {
  contacts: 'почта и телефон',
  login: 'данные для входа: пароль, Telegram, Яндекс ID и VK ID, сеансы с адресами и браузерами',
  profile: 'имя на витрине, «о себе», аватар, страна',
  payout: 'реквизиты для вывода',
  kyc: 'документы проверки личности',
  notifications: 'уведомления и устройства для пушей',
  interests: 'сохранённые поиски, подписки, ожидания поступления',
  chat: 'переписка по сделкам и вложения',
  dispute: 'переписка по спорам и вложения',
  delivery: 'данные для выдачи: ник, игровой ID, ссылка на обмен',
  goods: 'выданные ключи и данные аккаунтов',
} as const;

/** Информационная система, из которой уничтожены данные, — для акта. */
export const ERASURE_SYSTEM = 'Информационная система GameMarket (база данных PostgreSQL и файловое хранилище)';
/** Способ уничтожения — для акта. */
export const ERASURE_METHOD = 'Удаление записей из базы данных и файлов из хранилища без возможности восстановления; резервные копии перезаписываются по сроку их хранения';

/**
 * Пороги реестра посреднических цифровых платформ (289-ФЗ ст. 4,
 * постановление Правительства от 28.01.2026 № 54): за прошлый календарный
 * год в среднем от 100 тыс. пользователей из России в день и хотя бы одно —
 * от 10 тыс. продавцов со сделками или от 50 млрд ₽ сделок. Попали — закон
 * о платформенной экономике применяется целиком (`ПРОДУКТ/289-ФЗ.md`).
 * Пользователей в день считает Метрика, продавцов и оборот — площадка.
 */
export const REGISTRY_DAILY_USERS = 100_000;
export const REGISTRY_SELLERS = 10_000;
/** 50 млрд ₽ в копейках. */
export const REGISTRY_TURNOVER_MINOR = 50_000_000_000n * 100n;
/** С какой доли порога предупреждать заранее: готовить требования закона. */
export const REGISTRY_NEAR_SHARE = 0.5;

/** Где площадка относительно порогов: продавцы и оборот — доля от порога. */
export function registryStanding(sellers: number, turnoverMinor: bigint) {
  const sellersShare = sellers / REGISTRY_SELLERS;
  const turnoverShare = Number((turnoverMinor * 10_000n) / REGISTRY_TURNOVER_MINOR) / 10_000;
  const top = Math.max(sellersShare, turnoverShare);
  return { sellersShare, turnoverShare, reached: top >= 1, near: top >= REGISTRY_NEAR_SHARE };
}
