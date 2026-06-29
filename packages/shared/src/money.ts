/**
 * Деньги — только в минорных единицах (копейки) как bigint.
 * Никогда не храним и не считаем деньги во float.
 */
export type Minor = bigint;

export interface Money {
  amount: Minor; // минорные единицы
  currency: string; // ISO-4217, напр. 'RUB'
}

export const money = (amount: Minor | number, currency: string): Money => ({
  amount: typeof amount === 'number' ? BigInt(Math.round(amount)) : amount,
  currency,
});

/** Применить процент (0.1 = 10%) к сумме, округление к ближайшему минорному. */
export const applyPct = (amount: Minor, pct: number): Minor =>
  BigInt(Math.round(Number(amount) * pct));

/** Форматирование для отображения: 12345 -> "123.45". */
export const formatMinor = (amount: Minor, fractionDigits = 2): string => {
  const divisor = 10 ** fractionDigits;
  return (Number(amount) / divisor).toFixed(fractionDigits);
};

/** Сумма к оплате покупателем и выплата продавцу по правилам комиссии. */
export interface FeeBreakdown {
  base: Minor;
  feeBuyer: Minor;
  feeSeller: Minor;
  amountToPay: Minor; // платит покупатель
  sellerPayout: Minor; // получает продавец
  platformRevenue: Minor;
}

export const computeFees = (
  base: Minor,
  feeBuyerPct: number,
  feeSellerPct: number,
): FeeBreakdown => {
  const feeBuyer = applyPct(base, feeBuyerPct);
  const feeSeller = applyPct(base, feeSellerPct);
  const amountToPay = base + feeBuyer;
  const sellerPayout = base - feeSeller;
  return {
    base,
    feeBuyer,
    feeSeller,
    amountToPay,
    sellerPayout,
    platformRevenue: amountToPay - sellerPayout,
  };
};
