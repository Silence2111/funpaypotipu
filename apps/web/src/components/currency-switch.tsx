'use client';

import { useEffect, useState } from 'react';
import { getCurrency, loadRates, setCurrency, type DisplayCurrency } from '@/lib/currency';
import { useT } from '@/lib/i18n/client';

/**
 * Валюта показа цен: ₽, $ или €. Появляется, только когда площадка задала
 * курс: без курса «≈ $» был бы выдумкой.
 */
export function CurrencySwitch({ className, label }: { className?: string; label?: string }) {
  const t = useT();
  const [available, setAvailable] = useState(false);
  const [value, setValue] = useState<DisplayCurrency>('RUB');

  useEffect(() => {
    setValue(getCurrency());
    void loadRates().then((r) => setAvailable(!!r));
    const sync = () => setValue(getCurrency());
    window.addEventListener('gm-cur', sync);
    return () => window.removeEventListener('gm-cur', sync);
  }, []);

  if (!available) return null;
  const select = (
    <select
      className={`chip ${className ?? ''}`}
      aria-label={t('Валюта цен')}
      title={t('Валюта показа цен. Оплата — в рублях.')}
      value={value}
      onChange={(e) => setCurrency(e.target.value as DisplayCurrency)}
      style={{ paddingRight: 10, appearance: 'auto' }}
    >
      <option value="RUB">₽</option>
      <option value="USD">$</option>
      <option value="EUR">€</option>
    </select>
  );
  return label ? (
    <label className="row faint" style={{ gap: 8, fontSize: 13 }}>
      {label} {select}
    </label>
  ) : (
    select
  );
}
