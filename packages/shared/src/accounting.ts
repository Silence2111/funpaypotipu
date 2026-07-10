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
  | 'payout_payable';

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

/** Оплата заказа с карты/провайдера: деньги провайдера → эскроу. */
export const payToEscrowFromGateway = (amount: Minor): PostingLeg[] => [
  debit(gatewayClearing(), amount),
  credit(escrowHolding(), amount),
];

/** Пополнение баланса пользователя через провайдера: провайдер → баланс. */
export const depositToBalance = (userId: string, amount: Minor): PostingLeg[] => [
  debit(gatewayClearing(), amount),
  credit(userAccount(userId, 'available'), amount),
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

/** Кэшбэк покупателю на баланс за завершённую покупку (за счёт дохода площадки). */
export const cashbackToBalance = (buyerId: string, amount: Minor): PostingLeg[] => [
  debit(platformRevenue(), amount),
  credit(userAccount(buyerId, 'available'), amount),
];

/** Заявка на вывод: резервируем сумму с баланса в обязательства к выплате. */
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
