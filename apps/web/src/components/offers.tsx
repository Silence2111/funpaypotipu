import Link from 'next/link';
import { Star, Zap } from 'lucide-react';
import { isDemoSeller, qtyTiers } from '@gamemarket/shared';
import type { Attribute, ListingCard, SellerBrief } from '@/lib/api';
import { formatListingPrice, formatPrice, formatQty, perPackLabel } from '@/lib/format';
import { SaleMark } from './sale-mark';
import { isOnline } from '@/lib/presence';
import { RU, type T } from '@/lib/i18n/lang';
import { ApproxPrice } from './approx-price';

/** Сколько параметров раздела выносить в колонки; остальные — строкой под названием. */
const MAX_ATTR_COLUMNS = 2;

/** Параметры раздела, которые станут колонками таблицы: первые списочные. */
export function attrColumns(attributes: Attribute[]): Attribute[] {
  return attributes.filter((a) => a.type === 'enum').slice(0, MAX_ATTR_COLUMNS);
}

/** Значение параметра словами; «да/нет» — названием параметра, когда «да». */
function attrValue(a: Attribute, v: unknown, t: T): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v ? t.d(a.label) : null;
  return t.d(String(v));
}

/** Наличие показываем у того, что продаётся количеством: валюта и ключи. */
function hasStock(l: ListingCard): l is ListingCard & { stock: number } {
  return l.stock != null && (!!l.unitName || l.fulfillmentType === 'auto_key');
}

/**
 * Предложения раздела таблицей, как на FunPay: описание, параметры раздела,
 * продавец с рейтингом и «в сети», наличие, цена. Плитки с одинаковыми
 * заглушками прятали главное для покупателя — кто продаёт и почём.
 *
 * Вся строка — одна ссылка на лот. На телефоне колонок нет: параметры идут
 * строкой под названием, продавец и цена — под ними.
 *
 * Таблицу рисуют и серверные страницы, поэтому язык приходит пропом `t`.
 */
export function OfferTable({
  items,
  attributes = [],
  showSection = false,
  compact = false,
  hideSeller = false,
  t = RU,
}: {
  items: ListingCard[];
  /** Параметры раздела; без них таблица — описание, продавец, цена. */
  attributes?: Attribute[];
  /** Писать игру и раздел в строке: выдача поиска смешивает разделы. */
  showSection?: boolean;
  /** Узкая колонка (страница лота): параметры строкой, без своих колонок. */
  compact?: boolean;
  /** Все строки одного продавца («Ещё у продавца») — колонка продавца лишняя. */
  hideSeller?: boolean;
  /** Переводчик страницы: `await getT()` на сервере, `useT()` в браузере. */
  t?: T;
}) {
  const columns = compact ? [] : attrColumns(attributes);
  const extra = attributes.filter((a) => !columns.includes(a));
  // Колонка наличия — у раздела, где продают количеством. В смешанной выдаче
  // поиска у большинства строк в ней стояло бы тире: там наличие идёт строкой.
  const showStock = !showSection && !compact && items.some(hasStock);
  const template = [
    'minmax(0, 1fr)',
    ...columns.map(() => 'minmax(80px, 128px)'),
    ...(hideSeller ? [] : ['minmax(168px, 208px)']),
    ...(showStock ? ['minmax(88px, 112px)'] : []),
    'minmax(104px, 132px)',
  ].join(' ');

  return (
    <div className="offers" style={{ ['--offer-cols' as string]: template }}>
      <div className="offer-head" aria-hidden>
        <span>{t('Описание')}</span>
        {columns.map((c) => (
          <span key={c.key}>{t.d(c.label)}</span>
        ))}
        {!hideSeller && <span>{t('Продавец')}</span>}
        {showStock && <span className="num">{t('Наличие')}</span>}
        <span className="num">{t('Цена')}</span>
      </div>
      {items.map((l) => (
        <OfferRow
          key={l.id}
          listing={l}
          columns={columns}
          extra={extra}
          showStock={showStock}
          showSection={showSection}
          showSeller={!hideSeller}
          t={t}
        />
      ))}
    </div>
  );
}

function OfferRow({
  listing: l,
  columns,
  extra,
  showStock,
  showSection,
  showSeller,
  t,
}: {
  listing: ListingCard;
  columns: Attribute[];
  extra: Attribute[];
  showStock: boolean;
  showSection: boolean;
  showSeller: boolean;
  t: T;
}) {
  const attrs = l.attributes ?? {};
  const instant = l.fulfillmentType === 'auto_key' || l.fulfillmentType === 'provider';
  // Оплаченное продвижение помечается: покупатель должен видеть, почему лот выше.
  const promoted = !!l.promotedUntil && new Date(l.promotedUntil).getTime() > Date.now();
  const pack = perPackLabel(l, t);
  const stock = hasStock(l) ? l.stock : null;
  // Скидка за количество — наибольшая ступень: «оптом до −10%».
  const bulk = Math.max(0, ...qtyTiers(l.qtyDiscounts).map((x) => x.pct));
  const inline = (list: Attribute[]) =>
    list
      .map((a) => attrValue(a, attrs[a.key], t))
      .filter((v): v is string => !!v)
      .join(' · ');
  const extraText = inline(extra);
  const columnsText = inline(columns);

  return (
    <Link href={`/lot/${l.id}`} className="offer-row">
      <span className={l.images?.[0] ? 'offer-desc with-thumb' : 'offer-desc'}>
        {l.images?.[0] && (
          // Фото лота — миниатюрой в строке, как карточки Playerok.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="offer-thumb"
            src={l.images[0]}
            alt=""
            loading="lazy"
            width={48}
            height={48}
          />
        )}
        <span className="offer-text">
          <span className="offer-title">{l.title}</span>
          <span className="offer-meta">
            {showSection && (
              <span>
                {t.d(l.game.title)} · {t.d(l.category.title)}
              </span>
            )}
            {columnsText && <span className="only-mobile">{columnsText}</span>}
            {extraText && <span>{extraText}</span>}
            {stock != null && (
              <span className={showStock ? 'only-mobile' : undefined}>
                {t('в наличии {qty}', { qty: formatQty(stock, l.unitName, t) })}
              </span>
            )}
            {instant && (
              <span className="badge success">
                <Zap size={12} strokeWidth={2} aria-hidden /> {t('выдача сразу')}
              </span>
            )}
            {isDemoSeller(l.seller.profile?.username) && (
              <span
                className="demo-mark"
                title={t('Демонстрационный лот: показывает, как устроена сделка')}
              >
                {t('Пример')}
              </span>
            )}
            {promoted && <span>{t('продвижение')}</span>}
          </span>
        </span>
      </span>
      {columns.map((c) => (
        <span key={c.key} className="offer-attr">
          {attrValue(c, attrs[c.key], t) ?? <span className="faint">—</span>}
        </span>
      ))}
      {showSeller && <SellerCell seller={l.seller.profile} t={t} />}
      {/* Единица — в подписи цены («за 1 000 золота»), в колонке только число. */}
      {showStock && (
        <span className="offer-stock num">
          {stock != null ? t.num(stock) : <span className="faint">—</span>}
        </span>
      )}
      <span className="offer-price num">
        <span className="price">
          {pack ? formatPrice(l.price, l.currency, t) : formatListingPrice(l, t)}
        </span>
        <SaleMark listPrice={l.saleListPrice} price={l.price} currency={l.currency} t={t} />
        {pack ? (
          <span className="faint">{pack}</span>
        ) : (
          <ApproxPrice minor={l.price} currency={l.currency} />
        )}
        {bulk > 0 && <span className="faint">{t('оптом до −{pct}%', { pct: bulk })}</span>}
      </span>
    </Link>
  );
}

/** Продавец: аватар с точкой «в сети», имя, рейтинг с числом отзывов. */
export function SellerCell({ seller, t = RU }: { seller: SellerBrief | null; t?: T }) {
  if (!seller) return <span className="seller-cell faint">—</span>;
  const online = isOnline(seller.onlineAt);
  const reviews = seller.ratingCount ?? 0;
  return (
    <span className="seller-cell">
      <Avatar name={seller.username} url={seller.avatarUrl} online={online} t={t} />
      <span className="seller-text">
        <span className="seller-name">{seller.username}</span>
        <span className="seller-rating">
          {/* Рейтинг — только из настоящих отзывов; без них так и пишем. */}
          {reviews > 0 ? (
            <>
              <Star size={13} strokeWidth={1.75} className="star" aria-hidden />
              {seller.ratingAvg.toFixed(1)}
              <span className="faint">· {t.n(reviews, 'отз.', 'отз.', 'отз.')}</span>
            </>
          ) : (
            <span className="faint">{t('нет отзывов')}</span>
          )}
          {online && <span className="sr-only">, {t('в сети')}</span>}
        </span>
      </span>
    </span>
  );
}

export function Avatar({
  name,
  url,
  online = false,
  size = 36,
  t = RU,
}: {
  name: string;
  url?: string | null;
  online?: boolean;
  size?: number;
  /** Переводчик — для подсказки «в сети». */
  t?: T;
}) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" />
      ) : (
        (name || '?').charAt(0).toUpperCase()
      )}
      {online && <span className="presence" title={t('в сети')} />}
    </span>
  );
}
