'use client';

import { useEffect, useState } from 'react';
import { pricePlace } from '@gamemarket/shared/price-history';
import { apiFetch } from '@/lib/session';
import { formatPrice, offersCount } from '@/lib/format';
import { useT } from '@/lib/i18n/client';

interface Stats {
  count: number;
  scope: 'attrs' | 'category';
  min?: string;
  p25?: string;
  median?: string;
  p75?: string;
}

/**
 * Подсказка у поля цены: «С такими же параметрами сейчас 12 предложений:
 * от 450 ₽, чаще всего 600 ₽ – 900 ₽» и где среди них цена продавца. Цены —
 * в пачке лота; мало предложений — подсказки нет.
 */
export function PriceHint({
  categoryId,
  attrs,
  pack,
  except,
  price,
}: {
  categoryId: string;
  /** Выбранные параметры лота: звание, регион. */
  attrs: Record<string, string | boolean>;
  pack: number;
  /** Свой лот при изменении — не в счёт. */
  except?: string;
  /** Цена из поля, в копейках; 0 — ещё не введена. */
  price: number;
}) {
  const t = useT();
  const [stats, setStats] = useState<Stats | null>(null);
  const attrsKey = JSON.stringify(attrs);

  useEffect(() => {
    if (!categoryId) {
      setStats(null);
      return;
    }
    const timer = setTimeout(() => {
      const p = new URLSearchParams({ categoryId, pack: String(pack) });
      if (attrsKey !== '{}') p.set('attrs', attrsKey);
      if (except) p.set('except', except);
      apiFetch<Stats>(`/listings/price-stats?${p}`)
        .then(setStats)
        .catch(() => setStats(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [categoryId, attrsKey, pack, except]);

  if (!stats?.p25 || !stats.p75 || !stats.min) return null;
  const rub = (minor: string) => formatPrice(minor, 'RUB', t);
  const range = stats.p25 === stats.p75 ? rub(stats.p25) : `${rub(stats.p25)} – ${rub(stats.p75)}`;
  const vars = { offers: offersCount(stats.count, t), min: rub(stats.min), range };
  const text =
    stats.scope === 'attrs'
      ? t('С такими же параметрами сейчас {offers}: от {min}, чаще всего {range}.', vars)
      : t('В разделе сейчас {offers}: от {min}, чаще всего {range}.', vars);
  const place = price > 0 ? pricePlace(BigInt(price), { p25: stats.p25, p75: stats.p75 }) : null;
  return (
    <p className="hint" data-testid="price-hint">
      {text}{' '}
      {place === 'low'
        ? t('Ваша цена — среди самых низких.')
        : place === 'high'
          ? t('Ваша цена выше, чем у большинства.')
          : place === 'usual'
            ? t('Ваша цена — в обычном разбросе.')
            : null}
    </p>
  );
}
