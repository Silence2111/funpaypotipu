import { TrendingDown } from 'lucide-react';
import { PRICE_LOW_DAYS } from '@gamemarket/shared/price-history';
import { RU, type T } from '@/lib/i18n/lang';

/**
 * «Минимум за 30 дней»: цена лота ниже любой его цены за последние 30 дней.
 * Отметку ставит база при снижении цены, показывать ли — isPriceLow.
 */
export function PriceLowMark({ t = RU }: { t?: T }) {
  return (
    <span
      className="price-low"
      title={t('Цена ниже, чем когда-либо у этого лота за последние {n} дней', {
        n: PRICE_LOW_DAYS,
      })}
    >
      <TrendingDown size={13} strokeWidth={1.75} aria-hidden />
      {t('минимум за {n} дней', { n: PRICE_LOW_DAYS })}
    </span>
  );
}
