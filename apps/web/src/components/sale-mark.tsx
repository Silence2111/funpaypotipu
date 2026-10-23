import { saleOff } from '@gamemarket/shared/sale';
import { formatPrice } from '@/lib/format';
import { RU, type T } from '@/lib/i18n/lang';

/**
 * Скидка у цены: прежняя цена зачёркнута и «−20%»; со сроком — «до 24 окт.».
 * Без скидки ничего не рисует.
 */
export function SaleMark({
  listPrice,
  price,
  currency,
  until,
  t = RU,
}: {
  listPrice?: string | null;
  price: string;
  currency: string;
  /** Срок скидки — на странице лота; в строке раздела его нет. */
  until?: string | null;
  t?: T;
}) {
  const off = saleOff(listPrice, price);
  if (off === null) return null;
  return (
    <span className="sale-mark">
      <s className="faint">{formatPrice(listPrice!, currency, t)}</s>
      <span className="badge success">−{off}%</span>
      {until && (
        <span className="faint">
          {t('до {date}', {
            date: new Date(until).toLocaleDateString(t.locale, { day: 'numeric', month: 'long' }),
          })}
        </span>
      )}
    </span>
  );
}
