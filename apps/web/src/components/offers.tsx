import Link from 'next/link';
import { Star, Zap } from 'lucide-react';
import { isDemoSeller } from '@gamemarket/shared';
import type { Attribute, ListingCard, SellerBrief } from '@/lib/api';
import { formatListingPrice, formatPrice, formatQty, perPackLabel } from '@/lib/format';
import { isOnline } from '@/lib/presence';
import { ApproxPrice } from './approx-price';

/** Сколько параметров раздела выносить в колонки; остальные — строкой под названием. */
const MAX_ATTR_COLUMNS = 2;

/** Параметры раздела, которые станут колонками таблицы: первые списочные. */
export function attrColumns(attributes: Attribute[]): Attribute[] {
  return attributes.filter((a) => a.type === 'enum').slice(0, MAX_ATTR_COLUMNS);
}

/** Значение параметра словами; «да/нет» — названием параметра, когда «да». */
function attrValue(a: Attribute, v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v ? a.label : null;
  return String(v);
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
 */
export function OfferTable({
  items,
  attributes = [],
  showSection = false,
  compact = false,
  hideSeller = false,
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
        <span>Описание</span>
        {columns.map((c) => (
          <span key={c.key}>{c.label}</span>
        ))}
        {!hideSeller && <span>Продавец</span>}
        {showStock && <span className="num">Наличие</span>}
        <span className="num">Цена</span>
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
}: {
  listing: ListingCard;
  columns: Attribute[];
  extra: Attribute[];
  showStock: boolean;
  showSection: boolean;
  showSeller: boolean;
}) {
  const attrs = l.attributes ?? {};
  const instant = l.fulfillmentType === 'auto_key' || l.fulfillmentType === 'provider';
  // Оплаченное продвижение помечается: покупатель должен видеть, почему лот выше.
  const promoted = !!l.promotedUntil && new Date(l.promotedUntil).getTime() > Date.now();
  const pack = perPackLabel(l);
  const stock = hasStock(l) ? l.stock : null;
  const inline = (list: Attribute[]) =>
    list
      .map((a) => attrValue(a, attrs[a.key]))
      .filter((v): v is string => !!v)
      .join(' · ');
  const extraText = inline(extra);
  const columnsText = inline(columns);

  return (
    <Link href={`/lot/${l.id}`} className="offer-row">
      <span className="offer-desc">
        <span className="offer-title">{l.title}</span>
        <span className="offer-meta">
          {showSection && (
            <span>
              {l.game.title} · {l.category.title}
            </span>
          )}
          {columnsText && <span className="only-mobile">{columnsText}</span>}
          {extraText && <span>{extraText}</span>}
          {stock != null && (
            <span className={showStock ? 'only-mobile' : undefined}>
              в наличии {formatQty(stock, l.unitName)}
            </span>
          )}
          {instant && (
            <span className="badge success">
              <Zap size={12} strokeWidth={2} aria-hidden /> выдача сразу
            </span>
          )}
          {isDemoSeller(l.seller.profile?.username) && (
            <span
              className="demo-mark"
              title="Демонстрационный лот: показывает, как устроена сделка"
            >
              Пример
            </span>
          )}
          {promoted && <span>продвижение</span>}
        </span>
      </span>
      {columns.map((c) => (
        <span key={c.key} className="offer-attr">
          {attrValue(c, attrs[c.key]) ?? <span className="faint">—</span>}
        </span>
      ))}
      {showSeller && <SellerCell seller={l.seller.profile} />}
      {/* Единица — в подписи цены («за 1 000 золота»), в колонке только число. */}
      {showStock && (
        <span className="offer-stock num">
          {stock != null ? (
            new Intl.NumberFormat('ru-RU').format(stock)
          ) : (
            <span className="faint">—</span>
          )}
        </span>
      )}
      <span className="offer-price num">
        <span className="price">
          {pack ? formatPrice(l.price, l.currency) : formatListingPrice(l)}
        </span>
        {pack ? (
          <span className="faint">{pack}</span>
        ) : (
          <ApproxPrice minor={l.price} currency={l.currency} />
        )}
      </span>
    </Link>
  );
}

/** Продавец: аватар с точкой «в сети», имя, рейтинг с числом отзывов. */
export function SellerCell({ seller }: { seller: SellerBrief | null }) {
  if (!seller) return <span className="seller-cell faint">—</span>;
  const online = isOnline(seller.onlineAt);
  const reviews = seller.ratingCount ?? 0;
  return (
    <span className="seller-cell">
      <Avatar name={seller.username} url={seller.avatarUrl} online={online} />
      <span className="seller-text">
        <span className="seller-name">{seller.username}</span>
        <span className="seller-rating">
          {/* Рейтинг — только из настоящих отзывов; без них так и пишем. */}
          {reviews > 0 ? (
            <>
              <Star size={13} strokeWidth={1.75} className="star" aria-hidden />
              {seller.ratingAvg.toFixed(1)}
              <span className="faint">· {reviews} отз.</span>
            </>
          ) : (
            <span className="faint">нет отзывов</span>
          )}
          {online && <span className="sr-only">, в сети</span>}
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
}: {
  name: string;
  url?: string | null;
  online?: boolean;
  size?: number;
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
      {online && <span className="presence" title="в сети" />}
    </span>
  );
}
