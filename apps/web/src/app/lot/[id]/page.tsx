import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Info, ShieldCheck, Star, User } from 'lucide-react';
import { getListing, getPublicPricing } from '@/lib/api';
import { formatListingPrice, formatPrice, formatQty, perPackLabel } from '@/lib/format';
import { tileFor } from '@/lib/tile';
import { BuyButton } from '@/components/buy-button';
import { GameTopupForm } from '@/components/game-topup-form';
import { FavoriteButton } from '@/components/favorite-button';
import { MessageSellerButton } from '@/components/message-seller-button';
import { isDemoSeller, markupLabel, soldByQty, topupQuote } from '@gamemarket/shared';
import { JsonLd } from '@/components/json-ld';
import { KeysManager } from '@/components/keys-manager';
import { SellerReviews } from '@/components/seller-reviews';
import { OwnerLotActions } from '@/components/owner-lot-actions';
import { ReportButton } from '@/components/report-button';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) return { title: 'Лот не найден' };
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
  searchParams: Promise<{ created?: string; updated?: string; account?: string; amount?: string }>;
}) {
  const { id } = await params;
  const { created, updated, account, amount } = await searchParams;
  const [listing, pricing] = await Promise.all([getListing(id), getPublicPricing()]);
  if (!listing) notFound();
  const demo = isDemoSeller(listing.seller.profile?.username);
  const auto = listing.fulfillmentType === 'auto_key';
  const provider = listing.fulfillmentType === 'provider';
  const confirmH = pricing?.autoConfirmHours ?? 72;
  const fulfillH = pricing?.fulfillHours ?? 24;
  const soldOut = listing.status === 'sold_out';
  // Поштучно: цена за пачку, покупатель выбирает количество. У ключей поле
  // количества появляется, только когда на складе есть из чего выбирать.
  const pack = perPackLabel(listing);
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

  const attrs = Object.entries(listing.attributes ?? {});
  const cover = listing.images?.[0];

  return (
    <div className="container" style={{ paddingTop: 48 }}>
      <JsonLd data={productLd} />
      {created && (
        <div className="alert success" role="status" style={{ marginBottom: 20 }}>
          <ShieldCheck size={18} strokeWidth={1.75} />
          <span>
            {!soldOut
              ? 'Лот опубликован и уже виден в каталоге.'
              : auto
                ? 'Лот создан. Загрузите ключи на склад ниже — с первым ключом он появится в каталоге.'
                : 'Лот создан. Наличие — ноль: лот появится в каталоге, когда вы его пополните.'}
          </span>
        </div>
      )}
      {updated && (
        <div className="alert success" role="status" style={{ marginBottom: 20 }}>
          <ShieldCheck size={18} strokeWidth={1.75} />
          <span>Изменения сохранены и уже видны в каталоге.</span>
        </div>
      )}
      <div style={{ marginBottom: 20 }}>
        <Link href={`/igra/${listing.game.slug}`} className="faint" style={{ fontSize: 14 }}>
          ← {listing.game.title} · {listing.category.title}
        </Link>
      </div>

      <div className="lot-grid">
        {/* Медиа, панель покупки, описание: на телефоне панель сразу под картинкой */}
        <div style={{ gridArea: 'media' }}>
          <div className="thumb" style={{ aspectRatio: '16 / 9', marginBottom: 0 }}>
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
              />
            ) : (
              // Раньше здесь стояло «Нет изображения» посреди пустого блока
              // 16:9 — страница выглядела сломанной. Плитка игры честнее:
              // она не выдаёт себя за фотографию товара и не оставляет дыру.
              <div
                aria-hidden
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: 'inherit',
                  background: tileFor(listing.game.title).background,
                  color: tileFor(listing.game.title).color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 44,
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                }}
              >
                {tileFor(listing.game.title).initials}
              </div>
            )}
          </div>
        </div>

        <div className="stack-lg" style={{ gridArea: 'desc' }}>
          {demo && (
            <div className="alert" role="note">
              <Info size={18} strokeWidth={1.75} />
              <span>
                Это пример лота: по нему видно, как устроена сделка. Купить можно — оплата на стенде
                демонстрационная{auto ? ', а ключ придёт с пометкой «ПРИМЕР» и в игре не активируется' : ''}.
              </span>
            </div>
          )}
          <section>
            <h2 className="h2" style={{ fontSize: 20, marginBottom: 12 }}>
              Описание
            </h2>
            <p className="muted" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
              {listing.description}
            </p>
          </section>

          {attrs.length > 0 && (
            <section>
              <h2 className="h2" style={{ fontSize: 20, marginBottom: 12 }}>
                Характеристики
              </h2>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                {attrs.map(([k, v]) => (
                  <div key={k} className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="faint" style={{ fontSize: 14 }}>{k}</span>
                    <span style={{ fontSize: 14 }}>{String(v)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="card lot-aside" style={{ gridArea: 'aside', padding: 24 }}>
          <h1 className="h2" style={{ fontSize: 22, lineHeight: 1.25 }}>
            {listing.title}
          </h1>
          <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <span className={auto ? 'badge success' : 'badge'}>
              {auto
                ? 'Ключ сразу после оплаты'
                : provider
                  ? listing.game.slug === 'steam'
                    ? 'Пополнение по логину'
                    : 'Пополнение по игровому ID'
                  : 'Выдаёт продавец'}
            </span>
            {demo && <span className="demo-mark">Пример</span>}
            {soldOut && <span className="badge">Закончился</span>}
          </div>
          <div className="price" style={{ fontSize: 28, margin: topup || pack ? '16px 0 4px' : '16px 0' }}>
            {pack ? formatPrice(listing.price, listing.currency) : formatListingPrice(listing)}
            {pack && (
              <span className="faint" style={{ fontSize: 15, fontWeight: 500, letterSpacing: 0 }}> {pack}</span>
            )}
          </div>
          {topup && (
            <p className="hint" style={{ marginBottom: 16 }}>
              Сумму выбираете вы, наценка продавца — {markupLabel(topup.markupBps)}
            </p>
          )}
          {pack && !soldOut && (
            <p className="hint" style={{ marginBottom: 16 }}>
              Количество выбираете вы
              {listing.minQty && listing.minQty > 1 ? `, от ${formatQty(listing.minQty, listing.unitName)}` : ''}
            </p>
          )}

          {soldOut ? (
            <div className="card flat" style={{ padding: 16, background: 'var(--page)' }}>
              <p style={{ margin: 0, fontWeight: 600 }}>Лот закончился</p>
              <p className="hint" style={{ margin: '4px 0 0' }}>
                Продавец может пополнить наличие. Добавьте лот в избранное, чтобы не потерять его.
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
              Демо-оплата: платёжка не подключена, деньги не списываются.
            </p>
          )}

          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            <FavoriteButton listingId={listing.id} />
            <MessageSellerButton listingId={listing.id} />
          </div>
          <OwnerLotActions listingId={listing.id} sellerId={listing.seller.id} />
          <div style={{ marginTop: 8 }}>
            <ReportButton targetType="listing" targetId={listing.id} ownerId={listing.seller.id} />
          </div>

          <div className="card flat" style={{ marginTop: 16, padding: 16, background: 'var(--page)' }}>
            <div className="row" style={{ gap: 8, fontWeight: 700, fontSize: 14 }}>
              <ShieldCheck size={18} strokeWidth={1.75} color="var(--accent)" /> Как защищена покупка
            </div>
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13 }} className="muted">
              <li>Деньги лежат у площадки. Продавец получит их, только когда вы подтвердите получение.</li>
              <li>
                {auto
                  ? 'Ключ выдаётся сразу. Не выдался — деньги вернутся на баланс автоматически.'
                  : provider
                    ? 'Пополнение уходит сразу после оплаты. Не прошло — деньги вернутся на баланс автоматически.'
                    : `Продавец не выдал товар за ${fulfillH} ч — деньги вернутся на баланс автоматически.`}
              </li>
              <li>После выдачи у вас {confirmH} ч на проверку: подтвердить или открыть спор с арбитром.</li>
            </ul>
            {pricing && (
              <p className="hint" style={{ marginTop: 10 }}>
                +{Math.round(pricing.cashbackPct * 100)}% кэшбэк на баланс после подтверждения
              </p>
            )}
          </div>

          <hr className="divider" style={{ margin: '20px 0' }} />

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Link href={`/prodavec/${listing.seller.id}`} className="row muted" style={{ gap: 8, fontSize: 14 }}>
              <User size={16} strokeWidth={1.75} />
              {listing.seller.profile?.username ?? 'продавец'}
            </Link>
            {listing.seller.profile && listing.seller.profile.ratingCount > 0 ? (
              <span className="row faint" style={{ gap: 4, fontSize: 13 }}>
                <Star size={13} strokeWidth={1.75} />
                {listing.seller.profile.ratingAvg.toFixed(1)} · {listing.seller.profile.ratingCount}
              </span>
            ) : (
              <span className="faint" style={{ fontSize: 13 }}>отзывов пока нет</span>
            )}
          </div>
        </aside>
      </div>

      <KeysManager listingId={listing.id} sellerId={listing.seller.id} auto={auto} />

      <section style={{ marginTop: 48 }}>
        <h2 className="h2" style={{ fontSize: 20, marginBottom: 16 }}>Отзывы о продавце</h2>
        <SellerReviews sellerId={listing.seller.id} />
      </section>
    </div>
  );
}
