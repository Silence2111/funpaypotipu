'use client';

import { approx, useDisplayCurrency } from '@/lib/currency';
import { useT } from '@/lib/i18n/client';

/**
 * Цена в долларах или евро рядом с рублёвой — если покупатель выбрал
 * валюту. Примерно, по курсу площадки: платят всё равно в рублях, поэтому
 * рублёвая цена остаётся главной.
 */
export function ApproxPrice({ minor, currency = 'RUB', style }: { minor: string; currency?: string; style?: React.CSSProperties }) {
  const t = useT();
  const { currency: cur, rates } = useDisplayCurrency();
  if (cur === 'RUB' || currency !== 'RUB' || !rates) return null;
  return (
    <span className="faint" style={{ fontSize: 13, fontWeight: 400, letterSpacing: 0, ...style }}
      title={t('Примерно, по курсу площадки. Оплата — в рублях.')}>
      {approx(minor, cur, rates, t.locale)}
    </span>
  );
}
