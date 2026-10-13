/**
 * Пополнение на сумму покупателя.
 *
 * ## Зачем
 *
 * Самый короткий путь к первой покупке на таком продукте — «закинуть на
 * Steam». У Playerok это виджет в первом экране: логин, сумма, «Оплатить
 * 1 050 ₽». У Kupikod и GGSel на этом построен весь бизнес. У нас пополнение
 * было только лотом с фиксированной ценой: «1000 ₽ на Steam за 1080 ₽» —
 * нужна другая сумма, ищите другой лот.
 *
 * Здесь лот пополнения описан условиями, а не ценой: наценка продавца
 * и границы суммы. Покупатель вводит, сколько зачислить, и платит номинал
 * плюс наценку. Комиссия площадки берётся с продавца из этой цены — как
 * у любого лота (`FeesService`), отдельной арифметики для пополнений нет.
 *
 * ## Почему наценка в базисных пунктах
 *
 * Наценка округляется вверх до копейки, а float здесь врёт:
 * 0.07 × 100 000 = 7 000,000000000001, и ceil превращает это в лишнюю
 * копейку. Базисные пункты — целое число, вся арифметика идёт в bigint.
 */

import type { Minor } from './money';

/** Шаг суммы — целые рубли: копейки провайдеры пополнений не принимают. */
export const TOPUP_STEP: Minor = 100n;

/** Границы условий, которые продавец задать не может. */
export const TOPUP_LIMITS = {
  /** 30%: дороже — ошибка в цене или попытка обмана, а не наценка. */
  maxMarkupBps: 3000,
  minAmount: 100n,
  /** 100 000 ₽ за раз: крупнее — уже не «закинуть на Steam». */
  maxAmount: 10_000_000n,
} as const;

/** Условия лота «на сумму покупателя». */
export interface TopupTerms {
  /** Наценка продавца к номиналу: 800 = 8%. */
  markupBps: number;
  /** Границы номинала, минорные единицы. */
  min: Minor;
  max: Minor;
}

export interface TopupQuote {
  /** Сколько зачислится на счёт. */
  nominal: Minor;
  /** Наценка продавца. */
  markup: Minor;
  /** Сколько платит покупатель (без надбавки за оплату картой). */
  price: Minor;
}

/** Цена пополнения: номинал плюс наценка, наценка округляется вверх до копейки. */
export function topupQuote(nominal: Minor, markupBps: number): TopupQuote {
  const markup = (nominal * BigInt(markupBps) + 9_999n) / 10_000n;
  return { nominal, markup, price: nominal + markup };
}

const rub = (minor: Minor): string =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(minor) / 100)} ₽`;

/** «8%», «7,5%» — наценка для витрины. */
export const markupLabel = (bps: number): string =>
  `${String(+(bps / 100).toFixed(2)).replace('.', ',')}%`;

/** Почему эту сумму нельзя пополнить по этим условиям, или null, если можно. */
export function topupAmountError(
  nominal: Minor,
  terms: Pick<TopupTerms, 'min' | 'max'>,
): string | null {
  if (nominal <= 0n) return 'Укажите сумму пополнения';
  if (nominal % TOPUP_STEP !== 0n) return 'Сумма — целое число рублей';
  if (nominal < terms.min) return `Минимум — ${rub(terms.min)}`;
  if (nominal > terms.max) return `Максимум — ${rub(terms.max)}`;
  return null;
}

/** Проверка условий, которые задаёт продавец. null — условия годятся. */
export function topupTermsError(terms: TopupTerms): string | null {
  const { markupBps, min, max } = terms;
  if (!Number.isInteger(markupBps)) return 'Наценка задаётся в базисных пунктах, целым числом';
  if (markupBps < 0) return 'Наценка не может быть отрицательной';
  if (markupBps > TOPUP_LIMITS.maxMarkupBps) {
    return `Наценка — не больше ${markupLabel(TOPUP_LIMITS.maxMarkupBps)}`;
  }
  if (min % TOPUP_STEP !== 0n || max % TOPUP_STEP !== 0n) return 'Границы суммы — целые рубли';
  if (min < TOPUP_LIMITS.minAmount) return `Минимум — от ${rub(TOPUP_LIMITS.minAmount)}`;
  if (max > TOPUP_LIMITS.maxAmount) return `Максимум — не больше ${rub(TOPUP_LIMITS.maxAmount)}`;
  if (min > max) return 'Минимум больше максимума';
  return null;
}

/**
 * Лучшее предложение для суммы: самая низкая наценка среди тех, кто эту
 * сумму берёт. При равной наценке — первое в списке: порядок задаёт API.
 */
export function pickTopupOffer<T extends TopupTerms>(offers: readonly T[], nominal: Minor): T | null {
  let best: T | null = null;
  for (const o of offers) {
    if (nominal < o.min || nominal > o.max) continue;
    if (!best || o.markupBps < best.markupBps) best = o;
  }
  return best;
}

/** Общие границы по всем предложениям — для подсказки «от … до …». */
export function topupRange(offers: readonly TopupTerms[]): { min: Minor; max: Minor } | null {
  if (!offers.length) return null;
  let min = offers[0]!.min;
  let max = offers[0]!.max;
  for (const o of offers) {
    if (o.min < min) min = o.min;
    if (o.max > max) max = o.max;
  }
  return { min, max };
}

export interface TopupAccountSpec {
  label: string;
  placeholder: string;
  hint: string;
}

/** Что спрашивать у покупателя: у Steam — логин, у остальных — игровой ID. */
export function topupAccountSpec(gameSlug: string): TopupAccountSpec {
  if (gameSlug === 'steam') {
    return {
      label: 'Логин Steam',
      placeholder: 'Например, gamer_2007',
      // Самая частая ошибка — имя профиля вместо логина: пополнение не найдёт аккаунт.
      hint: 'Тот, с которым вы входите в Steam, — не имя профиля',
    };
  }
  return {
    label: 'Игровой ID или логин',
    placeholder: 'Например, 812345678',
    hint: 'Пополнение придёт на этот аккаунт',
  };
}

/**
 * Почему этот аккаунт не годится для пополнения, или null.
 *
 * Для Steam ловим типичные ошибки, а не сверяем с полным правилом Steam:
 * отказать в настоящем логине хуже, чем пропустить опечатку, — провайдер её
 * отклонит, и деньги вернутся на баланс (`FulfillmentService`).
 */
export function topupAccountError(gameSlug: string, account: string | null | undefined): string | null {
  const v = (account ?? '').trim();
  const steam = gameSlug === 'steam';
  if (!v) return steam ? 'Укажите логин Steam' : 'Укажите игровой ID или логин';
  if (v.length > 120) return 'Слишком длинный ID';
  if (!steam) return null;
  if (v.includes('@')) return 'Нужен логин Steam, а не почта';
  if (/\s/.test(v)) return 'В логине Steam нет пробелов — похоже, это имя профиля';
  if (/[^\x21-\x7E]/.test(v)) return 'Логин Steam пишется латиницей';
  if (v.length < 3) return 'Логин Steam — от 3 символов';
  if (v.length > 64) return 'Логин Steam — не длиннее 64 символов';
  return null;
}
