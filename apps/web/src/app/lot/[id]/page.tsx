import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Info, ShieldCheck } from 'lucide-react';
import { browseListings, getCategoryAttributes, getListing, getPublicPricing, getSeller, type Attribute } from '@/lib/api';
import { formatListingPrice, formatPrice, formatQty, perPackLabel } from '@/lib/format';
import { BuyButton } from '@/components/buy-button';
import { GameTopupForm } from '@/components/game-topup-form';
import { FavoriteButton } from '@/components/favorite-button';
import { ViewBeacon } from '@/components/view-beacon';
import { SaleMark } from '@/components/sale-mark';
import { isDemoSeller, markupLabel, soldByQty, topupQuote } from '@gamemarket/shared';
import { JsonLd, breadcrumbLd } from '@/components/json-ld';
import { KeysManager } from '@/components/keys-manager';
import { SellerReviews } from '@/components/seller-reviews';
import { OwnerLotActions } from '@/components/owner-lot-actions';
import { ReportButton } from '@/components/report-button';
import { ApproxPrice } from '@/components/approx-price';
import { OfferTable } from '@/components/offers';
import { SellerCard } from '@/components/seller-card';
import { MobileBuyBar } from '@/components/mobile-buy-bar';
import { LotGallery } from '@/components/lot-gallery';
import { getT } from '@/lib/i18n/server';
import type { T } from '@/lib/i18n/lang';

/** Параметры лота подписями раздела: «Звание: Gold Nova», а не «rank: Gold Nova». */
function paramRows(defs: Attribute[], values: Record<string, unknown>, t: T): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const a of defs) {
    const v = values[a.key];
    if (v === undefined || v === null || v === '') continue;
    rows.push([t.d(a.label), typeof v === 'boolean' ? (v ? t('да') : t('нет')) : t.d(String(v))]);
  }
  return rows;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [listing, t] = await Promise.all([getListing(id), getT()]);
  if (!listing) return { title: t('Лот не найден') };
  const desc = listing.description.slice(0, 160);
  return {
    title: listing.title,
    description: desc,
    openGraph: {
      title: listing.title,
      description: desc,
      images: listing.images?.length ? listing.images : undefined,
      type: 'website',
    },
    alternates: { canonical: `/lot/${id}` },
  };
}

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; updated?: string; stock?: string; account?: string; amount?: string }>;
}) {
  const { id } = await params;
  const { created, updated, stock, account, amount } = await searchParams;
  const [listing, pricing, t] = await Promise.all([getListing(id), getPublicPricing(), getT()]);
  if (!listing) notFound();
  // Всё, что вокруг лота: продавец целиком, подписи параметров, его другие
  // предложения и похожие у других продавцов — дешёвые сверху.
  const [seller, defs, mine, section] = await Promise.all([
    getSeller(listing.seller.id),
    getCategoryAttributes(listing.category.id),
    browseListings({ sellerId: listing.seller.id, limit: 7 }),
    browseListings({ gameSlug: listing.game.slug, categorySlug: listing.category.slug, sort: 'price_asc', limit: 12 }),
  ]);
  const sellerOthers = (mine?.items ?? []).filter((l) => l.id !== listing.id).slice(0, 6);
  const similar = (section?.items ?? [])
    .filter((l) => l.id !== listing.id && l.seller.id !== listing.seller.id)
    .slice(0, 6);
  const demo = isDemoSeller(listing.seller.profile?.username);
  const auto = listing.fulfillmentType === 'auto_key';
  // Автовыдача у аккаунтов и предметов — строка со склада продавца, а не ключ.
  const keys = auto && listing.category.fulfillmentType !== 'manual';
  const provider = listing.fulfillmentType === 'provider';
  // Выданное автоматически проверяют быстрее — срок короче, чем у ручной выдачи.
  const confirmH =
    auto || provider ? (pricing?.autoGoodsConfirmHours ?? 24) : (pricing?.autoConfirmHours ?? 72);
  const fulfillH = pricing?.fulfillHours ?? 24;
  const soldOut = listing.status === 'sold_out';
  // Поштучно: цена за пачку, покупатель выбирает количество. У ключей поле
  // количества появляется, только когда на складе есть из чего выбирать.
  const pack = perPackLabel(listing, t);
  const qtyOffer =
    soldByQty({ unitName: listing.unitName ?? null, fulfillmentType: listing.fulfillmentType }) &&
    (listing.unitName || listing.stock == null || listing.stock > 1)
      ? {
          price: listing.price,
          currency: listing.currency,
          unitName: listing.unitName ?? null,
          pricePerUnits: listing.pricePerUnits ?? 1,
          minQty: listing.minQty ?? 1,
          stock: listing.stock ?? null,
        }
      : undefined;

  // Лот «на сумму покупателя»: вместо кнопки «Купить» — форма суммы, цена «от».
  const topup =
    listing.topupMarkupBps != null && listing.topupMin != null && listing.topupMax != null
      ? {
          listingId: listing.id,
          title: listing.title,
          currency: listing.currency,
          markupBps: listing.topupMarkupBps,
          min: listing.topupMin,
          max: listing.topupMax,
          seller: { username: listing.seller.profile?.username ?? null },
        }
      : null;

  const major = (minor: bigint | string) => (Number(BigInt(minor)) / 100).toFixed(2);
  const sellerLd = { '@type': 'Person', name: listing.seller.profile?.username ?? 'seller' };
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    description: listing.description.slice(0, 300),
    image: listing.images ?? [],
    category: listing.category.title,
    offers: topup
      ? {
          '@type': 'AggregateOffer',
          lowPrice: major(topupQuote(BigInt(topup.min), topup.markupBps).price),
          highPrice: major(topupQuote(BigInt(topup.max), topup.markupBps).price),
          priceCurrency: listing.currency,
          availability: 'https://schema.org/InStock',
          seller: sellerLd,
        }
      : {
          '@type': 'Offer',
          price: major(listing.price),
          priceCurrency: listing.currency,
          availability: soldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
          seller: sellerLd,
        },
    ...(listing.seller.profile && listing.seller.profile.ratingAvg > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: listing.seller.profile.ratingAvg.toFixed(1),
            bestRating: '5',
          },
        }
      : {}),
  };

  const paramList = paramRows(defs ?? [], listing.attributes ?? {}, t);
  const categoryTitle = t.d(listing.category.title);
  const images = listing.images ?? [];
  const sectionHref = `/igra/${listing.game.slug}/${listing.category.slug}`;

  return (
    <div className="container" style={{ paddingTop: 32 }}>
      <ViewBeacon listingId={listing.id} />
      <JsonLd data={productLd} />
      <JsonLd
        data={breadcrumbLd([
          [t('Все игры'), '/igry'],
          [listing.game.title, `/igra/${listing.game.slug}`],
          [categoryTitle, sectionHref],
          [listing.title, `/lot/${listing.id}`],
        ])}
      />
      {created && (
        <div className="alert success" role="status" style={{ marginBottom: 20 }}>
          <ShieldCheck size={18} strokeWidth={1.75} />
          <span>
            {!soldOut
              ? t('Лот опубликован и уже виден в каталоге.')
              : auto
                ? keys
                  ? t('Лот создан. Загрузите ключи на склад ниже — с первым ключом он появится в каталоге.')
                  : t('Лот создан. Загрузите товар на склад ниже — с первой строкой он появится в каталоге.')
                : t('Лот создан. Наличие — ноль: лот появится в каталоге, когда вы его пополните.')}
          </span>
        </div>
      )}
      {updated && (
        <div className="alert success" role="status" style={{ marginBottom: 20 }}>
          <ShieldCheck size={18} strokeWidth={1.75} />
          <span>{t('Изменения сохранены и уже видны в каталоге.')}</span>
        </div>
      )}
      {stock && auto && soldOut && (
        <div className="alert success" role="status" style={{ marginBottom: 20 }}>
          <ShieldCheck size={18} strokeWidth={1.75} />
          <span>
            {t('Автовыдача включена. Загрузите товар на склад ниже — с первой строкой лот вернётся в каталог.')}
          </span>
        </div>
      )}
      <nav className="crumbs" aria-label={t('Путь')}>
        <Link href="/igry">{t('Все игры')}</Link>
        <span aria-hidden>/</span>
        <Link href={`/igra/${listing.game.slug}`}>{t.d(listing.game.title)}</Link>
        <span aria-hidden>/</span>
        <Link href={sectionHref}>{categoryTitle}</Link>
      </nav>

      <div className="lot-layout">
        <div className="lot-head">
          <h1 className="h1 lot-title">{listing.title}</h1>
          <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            <span className={auto ? 'badge success' : 'badge'}>
              {auto
                ? keys
                  ? t('Ключ сразу после оплаты')
                  : t('Выдача сразу после оплаты')
                : provider
                  ? listing.game.slug === 'steam'
                    ? t('Пополнение по логину')
                    : t('Пополнение по игровому ID')
                  : t('Выдаёт продавец')}
            </span>
            {demo && <span className="demo-mark">{t('Пример')}</span>}
            {soldOut && <span className="badge">{t('Закончился')}</span>}
            {listing.salesCount > 0 && (
              <span className="lot-sold">{t('Продаж: {n}', { n: t.num(listing.salesCount) })}</span>
            )}
          </div>
        </div>

        <aside className="lot-aside" aria-label={t('Покупка')}>
          <div className="card lot-buy" id="buy" style={{ padding: 24 }}>
            <div className="price" style={{ fontSize: 28, margin: topup || pack ? '0 0 4px' : '0 0 16px' }}>
              {pack ? formatPrice(listing.price, listing.currency, t) : formatListingPrice(listing, t)}
              {pack && (
                <span className="faint" style={{ fontSize: 15, fontWeight: 500, letterSpacing: 0 }}> {pack}</span>
              )}{' '}
              <ApproxPrice minor={listing.price} currency={listing.currency} style={{ fontSize: 15 }} />
            </div>
            {listing.saleListPrice && (
              <div style={{ margin: '-8px 0 16px' }}>
                <SaleMark
                  listPrice={listing.saleListPrice}
                  price={listing.price}
                  currency={listing.currency}
                  until={listing.saleUntil}
                  t={t}
                />
              </div>
            )}
            {topup && (
              <p className="hint" style={{ marginBottom: 16 }}>
                {t('Сумму выбираете вы, наценка продавца — {pct}', { pct: markupLabel(topup.markupBps) })}
              </p>
            )}
            {pack && !soldOut && (
              <p className="hint" style={{ marginBottom: 16 }}>
                {listing.minQty && listing.minQty > 1
                  ? t('Количество выбираете вы, от {qty}', { qty: formatQty(listing.minQty, listing.unitName, t) })
                  : t('Количество выбираете вы')}
              </p>
            )}

            {soldOut ? (
              <div className="card flat" style={{ padding: 16, background: 'var(--page)' }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{t('Лот закончился')}</p>
                <p className="hint" style={{ margin: '4px 0 0' }}>
                  {t(
                    'Продавец может пополнить наличие. Добавьте лот в избранное, чтобы не потерять его, или посмотрите похожие предложения ниже.',
                  )}
                </p>
              </div>
            ) : topup ? (
              <GameTopupForm
                variant="lot"
                game={listing.game}
                offers={[topup]}
                returnPath={`/lot/${listing.id}`}
                initialAccount={(account ?? '').slice(0, 120)}
                initialAmount={amount ?? ''}
              />
            ) : (
              <BuyButton
                listingId={listing.id}
                fulfillmentType={listing.fulfillmentType}
                price={listing.price}
                currency={listing.currency}
                qtyOffer={qtyOffer}
                buyerFields={listing.fulfillmentType === 'manual' ? listing.buyerFields ?? [] : []}
              />
            )}
            {pricing?.paymentsDemo && !soldOut && (
              <p className="hint" style={{ marginTop: 10, textAlign: 'center' }}>
                {t('Демо-оплата: платёжка не подключена, деньги не списываются.')}
              </p>
            )}

            <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
              <FavoriteButton listingId={listing.id} />
            </div>
            <OwnerLotActions listingId={listing.id} sellerId={listing.seller.id} />

            <div className="card flat" style={{ marginTop: 16, padding: 16, background: 'var(--page)' }}>
              <div className="row" style={{ gap: 8, fontWeight: 700, fontSize: 14 }}>
                <ShieldCheck size={18} strokeWidth={1.75} color="var(--accent)" /> {t('Как защищена покупка')}
              </div>
              <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13 }} className="muted">
                <li>{t('Деньги лежат у площадки. Продавец получит их, только когда вы подтвердите получение.')}</li>
                <li>
                  {auto
                    ? keys
                      ? t('Ключ выдаётся сразу. Не выдался — деньги вернутся на баланс автоматически.')
                      : t('Товар выдаётся со склада продавца сразу. Не выдался — деньги вернутся на баланс автоматически.')
                    : provider
                      ? t('Пополнение уходит сразу после оплаты. Не прошло — деньги вернутся на баланс автоматически.')
                      : t('Продавец не выдал товар за {h} ч — деньги вернутся на баланс автоматически.', {
                          h: fulfillH,
                        })}
                </li>
                <li>
                  {t('После выдачи у вас {h} ч на проверку: подтвердить или открыть спор с арбитром.', { h: confirmH })}
                </li>
              </ul>
              {pricing && (
                <p className="hint" style={{ marginTop: 10 }}>
                  {t('+{pct}% кэшбэк на баланс после подтверждения', { pct: Math.round(pricing.cashbackPct * 100) })}
                </p>
              )}
            </div>
          </div>

          {seller && (
            <SellerCard seller={seller} lot={{ id: listing.id, manual: listing.fulfillmentType === 'manual' }} />
          )}
          <div>
            <ReportButton targetType="listing" targetId={listing.id} ownerId={listing.seller.id} />
          </div>
        </aside>

        <div className="lot-main">
          {demo && (
            <div className="alert" role="note">
              <Info size={18} strokeWidth={1.75} />
              <span>
                {keys
                  ? t(
                      'Это пример лота: по нему видно, как устроена сделка. Купить можно — оплата на стенде демонстрационная, а ключ придёт с пометкой «ПРИМЕР» и в игре не активируется.',
                    )
                  : t(
                      'Это пример лота: по нему видно, как устроена сделка. Купить можно — оплата на стенде демонстрационная.',
                    )}
              </span>
            </div>
          )}

          {/* Фото — только настоящие. Без них страница не рисует заглушку на
              полэкрана: она выдавала себя за картинку товара. */}
          {images.length > 0 && <LotGallery images={images.slice(0, 12)} title={listing.title} />}

          {paramList.length > 0 && (
            <section>
              <h2 className="h2 lot-h2">{t('Параметры')}</h2>
              <dl className="params">
                <div>
                  <dt>{t('Раздел')}</dt>
                  <dd>
                    <Link href={sectionHref} className="inline-link">
                      {t.d(listing.game.title)} · {categoryTitle}
                    </Link>
                  </dd>
                </div>
                {paramList.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section>
            <h2 className="h2 lot-h2">{t('Описание')}</h2>
            <p className="muted" style={{ whiteSpace: 'pre-wrap', margin: 0, maxWidth: '68ch' }}>
              {listing.description}
            </p>
          </section>

          {/* Похожие и другие лоты продавца — здесь, а не под страницей: колонка
              с покупкой и продавцом высокая, и слева оставалась пустота. */}
          {similar.length > 0 && (
            <section aria-labelledby="similar-title">
              <div className="section-head" style={{ marginBottom: 6 }}>
                <h2 className="h2 lot-h2" id="similar-title" style={{ margin: 0 }}>
                  {t('Похожие предложения')}
                </h2>
                <Link href={`${sectionHref}?sort=price_asc`} className="muted" style={{ fontSize: 14 }}>
                  {t('Весь раздел →')}
                </Link>
              </div>
              <p className="faint" style={{ fontSize: 14, margin: '0 0 12px' }}>
                {t('У других продавцов этого раздела — сначала дешёвые')}
              </p>
              <OfferTable items={similar} attributes={defs ?? []} compact t={t} />
            </section>
          )}

          {sellerOthers.length > 0 && (
            <section aria-labelledby="seller-more-title">
              <div className="section-head" style={{ marginBottom: 12 }}>
                <h2 className="h2 lot-h2" id="seller-more-title" style={{ margin: 0 }}>
                  {t('Ещё у продавца')}
                </h2>
                <Link href={`/prodavec/${listing.seller.id}`} className="muted" style={{ fontSize: 14 }}>
                  {t('Все →')}
                </Link>
              </div>
              <OfferTable items={sellerOthers} showSection compact hideSeller t={t} />
            </section>
          )}
        </div>
      </div>

      <KeysManager listingId={listing.id} sellerId={listing.seller.id} auto={auto} keys={keys} />
      {!soldOut && (
        <MobileBuyBar
          target="#buy"
          price={pack ? formatPrice(listing.price, listing.currency, t) : formatListingPrice(listing, t)}
          note={pack}
          label={topup ? t('Пополнить аккаунт') : t('Купить')}
        />
      )}

      <section style={{ marginTop: 48 }}>
        <h2 className="h2 lot-h2">{t('Отзывы о продавце')}</h2>
        <SellerReviews sellerId={listing.seller.id} preview={5} />
      </section>
    </div>
  );
}
