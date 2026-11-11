/**
 * Чистое ядро двойной бухгалтерии (см. docs/03).
 * Функции возвращают сбалансированные наборы проводок (legs); персистентность —
 * в api/modules/ledger. Здесь нет БД и побочных эффектов → всё легко тестируется.
 */
import type { Minor } from './money';

export type AccountKind =
  | 'available'
  | 'escrow'
  | 'revenue'
  | 'fees_payable'
  | 'gateway_clearing'
  | 'payout_payable'
  // Удержано модератором (часть 134): не тратится и не выводится.
  | 'held';

export type OwnerType = 'user' | 'platform' | 'external';
export type Direction = 'debit' | 'credit';

export interface AccountRef {
  ownerType: OwnerType;
  ownerId: string | null;
  kind: AccountKind;
}

export interface PostingLeg {
  account: AccountRef;
  direction: Direction;
  amount: Minor;
}

// ── Ссылки на счета ──
export const platformAccount = (kind: AccountKind): AccountRef => ({
  ownerType: 'platform',
  ownerId: null,
  kind,
});
export const userAccount = (userId: string, kind: AccountKind): AccountRef => ({
  ownerType: 'user',
  ownerId: userId,
  kind,
});
export const gatewayClearing = (): AccountRef => platformAccount('gateway_clearing');
export const escrowHolding = (): AccountRef => platformAccount('escrow');
export const platformRevenue = (): AccountRef => platformAccount('revenue');

const debit = (account: AccountRef, amount: Minor): PostingLeg => ({ account, direction: 'debit', amount });
const credit = (account: AccountRef, amount: Minor): PostingLeg => ({ account, direction: 'credit', amount });

// ── Денежные потоки (docs/03 §3) ──

/**
 * Надбавка способа оплаты (карта +4.4%): покупатель платит её сверх суммы,
 * но в эскроу и на баланс она не попадает — это плата за приём платежа,
 * обязательство перед платёжной системой (`fees_payable`). Сверка с отчётом
 * провайдера закрывает её фактической комиссией.
 */
const surchargeLegs = (surcharge: Minor): PostingLeg[] =>
  surcharge > 0n ? [credit(platformAccount('fees_payable'), surcharge)] : [];

/** Оплата заказа с карты/провайдера: деньги провайдера → эскроу, надбавка — отдельно. */
export const payToEscrowFromGateway = (amount: Minor, surcharge: Minor = 0n): PostingLeg[] => [
  debit(gatewayClearing(), amount + surcharge),
  credit(escrowHolding(), amount),
  ...surchargeLegs(surcharge),
];

/** Пополнение баланса пользователя через провайдера: провайдер → баланс, надбавка — отдельно. */
export const depositToBalance = (userId: string, amount: Minor, surcharge: Minor = 0n): PostingLeg[] => [
  debit(gatewayClearing(), amount + surcharge),
  credit(userAccount(userId, 'available'), amount),
  ...surchargeLegs(surcharge),
];

/** Оплата заказа с баланса покупателя → эскроу. */
export const payToEscrowFromBalance = (buyerId: string, amount: Minor): PostingLeg[] => [
  debit(userAccount(buyerId, 'available'), amount),
  credit(escrowHolding(), amount),
];

/** Завершение сделки: эскроу → продавцу (выплата) + комиссия площадке. */
export const releaseEscrow = (
  sellerId: string,
  sellerPayout: Minor,
  revenue: Minor,
): PostingLeg[] => [
  debit(escrowHolding(), sellerPayout + revenue),
  credit(userAccount(sellerId, 'available'), sellerPayout),
  credit(platformRevenue(), revenue),
];

/** Возврат покупателю на баланс (спор в его пользу / отмена после оплаты). */
export const refundToBalance = (buyerId: string, amount: Minor): PostingLeg[] => [
  debit(escrowHolding(), amount),
  credit(userAccount(buyerId, 'available'), amount),
];

/**
 * «Безопасная сделка» (часть 123): завершение — доля продавца не на его
 * баланс у площадки, а в обязательство к выплате по сделке ЮKassa;
 * вознаграждение — в доход.
 */
export const releaseEscrowToDeal = (sellerPayout: Minor, revenue: Minor): PostingLeg[] => [
  debit(escrowHolding(), sellerPayout + revenue),
  credit(platformAccount('payout_payable'), sellerPayout),
  credit(platformRevenue(), revenue),
];

/** «Безопасная сделка»: возврат — деньги уходят со сделки обратно на карту покупателя. */
export const refundToGateway = (amount: Minor): PostingLeg[] => [
  debit(escrowHolding(), amount),
  credit(gatewayClearing(), amount),
];

/**
 * Отмена с возвратом на карту или по СБП (часть 137): эскроу и надбавка
 * способа уходят обратно шлюзу — покупателю возвращается всё, что списали.
 * Надбавка из обязательства перед платёжной системой возвращается вместе с
 * суммой: её потерю площадка берёт на себя.
 */
export const refundToOriginal = (amount: Minor, surcharge: Minor = 0n): PostingLeg[] => [
  debit(escrowHolding(), amount),
  ...(surcharge > 0n ? [debit(platformAccount('fees_payable'), surcharge)] : []),
  credit(gatewayClearing(), amount + surcharge),
];

/** Кэшбэк покупателю на баланс за завершённую покупку (за счёт дохода площадки). */
export const cashbackToBalance = (buyerId: string, amount: Minor): PostingLeg[] => [
  debit(platformRevenue(), amount),
  credit(userAccount(buyerId, 'available'), amount),
];

/** Вознаграждение партнёру со сделки привлечённого (часть 116): из дохода площадки на баланс. */
export const partnerRewardToBalance = (partnerId: string, amount: Minor): PostingLeg[] => [
  debit(platformRevenue(), amount),
  credit(userAccount(partnerId, 'available'), amount),
];

/** Платная услуга площадки с баланса (продвижение лота): баланс → доход площадки. */
export const chargeFromBalance = (userId: string, amount: Minor): PostingLeg[] => [
  debit(userAccount(userId, 'available'), amount),
  credit(platformRevenue(), amount),
];

/** Заявка на вывод: резервируем сумму с баланса в обязательства к выплате. */
/** Удержать спорную сумму (часть 134): с доступного — на «удержано» того же человека. */
export const holdFunds = (userId: string, amount: Minor): PostingLeg[] => [
  debit(userAccount(userId, 'available'), amount),
  credit(userAccount(userId, 'held'), amount),
];

/** Снять удержание: деньги снова доступны. */
export const releaseHeldFunds = (userId: string, amount: Minor): PostingLeg[] => [
  debit(userAccount(userId, 'held'), amount),
  credit(userAccount(userId, 'available'), amount),
];

export const holdForPayout = (userId: string, amount: Minor): PostingLeg[] => [
  debit(userAccount(userId, 'available'), amount),
  credit(platformAccount('payout_payable'), amount),
];

/** Выплата отправлена наружу: обязательство → шлюз (нетто) + комиссия в доход. */
export const settlePayout = (amount: Minor, fee: Minor = 0n): PostingLeg[] => [
  debit(platformAccount('payout_payable'), amount),
  credit(gatewayClearing(), amount - fee),
  ...(fee > 0n ? [credit(platformRevenue(), fee)] : []),
];

/** Заявка отклонена: возвращаем зарезервированное на баланс. */
export const reversePayoutHold = (userId: string, amount: Minor): PostingLeg[] => [
  debit(platformAccount('payout_payable'), amount),
  credit(userAccount(userId, 'available'), amount),
];

// ── Инвариант ──
export class UnbalancedPostingError extends Error {
  constructor(debitSum: Minor, creditSum: Minor) {
    super(`Проводки не сбалансированы: debit=${debitSum} credit=${creditSum}`);
    this.name = 'UnbalancedPostingError';
  }
}

/** Сумма дебетов должна равняться сумме кредитов. Бросает, если нет. */
export const assertBalanced = (legs: PostingLeg[]): void => {
  let d = 0n;
  let c = 0n;
  for (const leg of legs) {
    if (leg.amount < 0n) throw new Error('Отрицательная сумма проводки');
    if (leg.direction === 'debit') d += leg.amount;
    else c += leg.amount;
  }
  if (d !== c) throw new UnbalancedPostingError(d, c);
};

/** Знаковая дельта для денормализованного баланса (кредит-положительный). */
export const balanceDelta = (leg: PostingLeg): Minor =>
  leg.direction === 'credit' ? leg.amount : -leg.amount;
