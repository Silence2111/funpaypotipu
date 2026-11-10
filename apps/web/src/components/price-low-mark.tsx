import { TrendingDown } from 'lucide-react';
import { PRICE_LOW_DAYS } from '@gamemarket/shared/price-history';
import { formatPrice, perPackLabel } from '@/lib/format';
import { RU, type T } from '@/lib/i18n/lang';

/**
 * «Минимум за 30 дней»: цена лота ниже любой его цены за последние 30 дней,
 * и «−12%» — насколько её снизили с той, что была до снижений. Отметку
 * ставит база при снижении цены, показывать ли — isPriceLow.
 */
export function PriceLowMark({
  l,
  t = RU,
}: {
  l: {
    currency: string;
    priceLowRef?: string | null;
    priceDropPct?: number | null;
    unitName?: string | null;
    pricePerUnits?: number;
  };
  t?: T;
}) {
  const pack = perPackLabel(l, t);
  const label = t('минимум за {n} дней', { n: PRICE_LOW_DAYS });
  const title = l.priceLowRef
    ? t('Цена снижена с {price} и ниже, чем когда-либо у этого лота за последние {n} дней', {
        price: `${formatPrice(l.priceLowRef, l.currency, t)}${pack ? ` ${pack}` : ''}`,
        n: PRICE_LOW_DAYS,
      })
    : t('Цена ниже, чем когда-либо у этого лота за последние {n} дней', { n: PRICE_LOW_DAYS });
  return (
    <span className="price-low" title={title}>
      <TrendingDown size={13} strokeWidth={1.75} aria-hidden />
      {l.priceDropPct ? `−${l.priceDropPct}% · ${label}` : label}
    </span>
  );
}
