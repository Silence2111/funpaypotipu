import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShieldCheck, Star, User } from 'lucide-react';
import { getListing } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { BuyButton } from '@/components/buy-button';
import { FavoriteButton } from '@/components/favorite-button';
import { MessageSellerButton } from '@/components/message-seller-button';
import { priceWithAcquiring, PAYMENT_METHODS } from '@gamemarket/shared';
import { JsonLd } from '@/components/json-ld';
import { KeysManager } from '@/components/keys-manager';
import { SellerReviews } from '@/components/seller-reviews';

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

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) notFound();

  const priceMajor = (Number(BigInt(listing.price)) / 100).toFixed(2);
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    description: listing.description.slice(0, 300),
    image: listing.images ?? [],
    category: listing.category.title,
    offers: {
      '@type': 'Offer',
      price: priceMajor,
      priceCurrency: listing.currency,
      availability: 'https://schema.org/InStock',
      seller: { '@type': 'Person', name: listing.seller.profile?.username ?? 'seller' },
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
      <div style={{ marginBottom: 20 }}>
        <Link href={`/igra/${listing.game.slug}`} className="faint" style={{ fontSize: 14 }}>
          ← {listing.game.title} · {listing.category.title}
        </Link>
      </div>

      <div className="lot-grid">
        {/* Left: media + description */}
        <div className="stack-lg">
          <div className="thumb" style={{ aspectRatio: '16 / 9', marginBottom: 0 }}>
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
              />
            ) : (
              <span className="faint">Нет изображения</span>
            )}
          </div>

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

        {/* Right: purchase panel */}
        <aside className="card" style={{ position: 'sticky', top: 72, padding: 24 }}>
          <h1 className="h2" style={{ fontSize: 22, lineHeight: 1.25 }}>
            {listing.title}
          </h1>
          <span className="badge" style={{ marginTop: 8 }}>
            {listing.fulfillmentType === 'auto_key'
              ? 'Автовыдача · мгновенно'
              : listing.fulfillmentType === 'provider'
                ? 'Пополнение по игровому ID'
                : 'Выдача продавцом'}
          </span>
          <div className="price" style={{ fontSize: 28, margin: '16px 0' }}>
            {formatPrice(listing.price, listing.currency)}
          </div>

          {(() => {
            const base = BigInt(listing.price);
            const card = PAYMENT_METHODS.find((m) => m.key === 'card')!;
            const cardPrice = priceWithAcquiring(base, card).toString();
            return (
              <details style={{ marginBottom: 14 }}>
                <summary className="faint" style={{ fontSize: 13, cursor: 'pointer' }}>
                  Цена по способу оплаты
                </summary>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                    <span className="muted">С баланса · СБП · крипта</span>
                    <span>{formatPrice(listing.price, listing.currency)}</span>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                    <span className="muted">Карта · Apple Pay · Google Pay</span>
                    <span>{formatPrice(cardPrice, listing.currency)} <span className="faint">+4.4%</span></span>
                  </div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                    С баланса — без комиссии эквайринга (и +2% кэшбэк)
                  </div>
                </div>
              </details>
            );
          })()}

          <BuyButton listingId={listing.id} fulfillmentType={listing.fulfillmentType} />

          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            <FavoriteButton listingId={listing.id} />
            <MessageSellerButton listingId={listing.id} />
          </div>

          <div className="badge" style={{ marginTop: 10, background: 'rgba(52,199,89,0.12)', color: '#1a7f37' }}>
            +2% кэшбэк на баланс с этой покупки
          </div>

          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {[
              'Оплата защищена эскроу',
              'Возврат, если товар не получен',
              'Возврат, если товар не как в описании',
            ].map((t) => (
              <div key={t} className="row faint" style={{ fontSize: 13, gap: 6 }}>
                <ShieldCheck size={15} strokeWidth={1.75} /> {t}
              </div>
            ))}
          </div>

          <hr className="divider" style={{ margin: '20px 0' }} />

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Link href={`/prodavec/${listing.seller.id}`} className="row muted" style={{ gap: 8, fontSize: 14 }}>
              <User size={16} strokeWidth={1.75} />
              {listing.seller.profile?.username ?? 'продавец'}
            </Link>
            {listing.seller.profile && listing.seller.profile.ratingCount > 0 && (
              <span className="row faint" style={{ gap: 4, fontSize: 13 }}>
                <Star size={13} strokeWidth={1.75} />
                {listing.seller.profile.ratingAvg.toFixed(1)} · {listing.seller.profile.ratingCount}
              </span>
            )}
          </div>
        </aside>
      </div>

      <KeysManager listingId={listing.id} />

      <section style={{ marginTop: 48 }}>
        <h2 className="h2" style={{ fontSize: 20, marginBottom: 16 }}>Отзывы о продавце</h2>
        <SellerReviews sellerId={listing.seller.id} />
      </section>
    </div>
  );
}
