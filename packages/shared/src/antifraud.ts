/**
 * Защита от мошенничества (часть 128, docs/06): лимиты новичков, частота
 * оплат и запрет сделок между связанными аккаунтами. Значения меняет
 * администратор в консоли (system_settings, ключ ANTIFRAUD_KEY); здесь —
 * значения по умолчанию и проверки, общие для API и консоли.
 *
 * Без zod и без Node: модуль идёт и в браузер.
 */

export const ANTIFRAUD_KEY = 'antifraud';

/** Новичок — аккаунт моложе стольких часов без единой завершённой сделки. */
export const NEWBIE_HOURS = 72;

export interface AntifraudSettings {
  /** Лимиты включены: в бою — да; в e2e выключены, сценарий 128 включает сам. */
  enabled: boolean;
  /** Сколько новичок может оплатить картой или СБП за сутки, копейки. */
  newbiePayDay: number;
  /** Попыток оплаты в час: у всех и у новичка. */
  paymentsPerHour: number;
  newbiePaymentsPerHour: number;
  /** Сколько лотов новичок может выставить за сутки. */
  newbieLotsPerDay: number;
  /** Сделки между аккаунтами одного человека (общее устройство или реквизиты) — запрет. */
  blockLinkedDeals: boolean;
}

export const ANTIFRAUD_DEFAULTS: AntifraudSettings = {
  enabled: true,
  newbiePayDay: 1_500_000,
  paymentsPerHour: 20,
  newbiePaymentsPerHour: 6,
  newbieLotsPerDay: 30,
  blockLinkedDeals: true,
};

/** Пределы для формы консоли: меньше — ломает честных, больше — бессмысленно. */
export const ANTIFRAUD_LIMITS = {
  newbiePayDay: { min: 100_000, max: 100_000_000 },
  paymentsPerHour: { min: 3, max: 200 },
  newbiePaymentsPerHour: { min: 1, max: 100 },
  newbieLotsPerDay: { min: 1, max: 1000 },
} as const;

/** Сохранённые настройки поверх значений по умолчанию; мусор — по умолчанию. */
export function antifraudSettings(saved: unknown, defaults: AntifraudSettings = ANTIFRAUD_DEFAULTS): AntifraudSettings {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof AntifraudSettings, unknown>>;
  const num = (k: keyof typeof ANTIFRAUD_LIMITS) => {
    const v = s[k];
    const { min, max } = ANTIFRAUD_LIMITS[k];
    return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : defaults[k];
  };
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : defaults.enabled,
    newbiePayDay: num('newbiePayDay'),
    paymentsPerHour: num('paymentsPerHour'),
    newbiePaymentsPerHour: num('newbiePaymentsPerHour'),
    newbieLotsPerDay: num('newbieLotsPerDay'),
    blockLinkedDeals: typeof s.blockLinkedDeals === 'boolean' ? s.blockLinkedDeals : defaults.blockLinkedDeals,
  };
}

/** Новичок: аккаунт моложе NEWBIE_HOURS и ни одной завершённой сделки. */
export function isNewbie(createdAt: Date, completedDeals: number, now = new Date()): boolean {
  return completedDeals === 0 && now.getTime() - createdAt.getTime() < NEWBIE_HOURS * 3_600_000;
}

/** Почему аккаунты связаны — для консоли и причины отказа. */
export type LinkReason = 'device' | 'requisites' | 'ip';
export const LINK_REASON_LABEL: Record<LinkReason, string> = {
  device: 'общий браузер',
  requisites: 'общие реквизиты вывода',
  ip: 'общий адрес IP',
};
/** IP — слабая связь (мобильные сети, общий Wi-Fi): показываем, но не запрещаем. */
export const STRONG_LINKS: readonly LinkReason[] = ['device', 'requisites'];
