import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Info, ShieldCheck, Star, User } from 'lucide-react';
import { getListing, getPublicPricing } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { tileFor } from '@/lib/tile';
import { BuyButton } from '@/components/buy-button';
import { FavoriteButton } from '@/components/favorite-button';
import { MessageSellerButton } from '@/components/message-seller-button';
import { priceWithAcquiring, PAYMENT_METHODS, isDemoSeller } from '@gamemarket/shared';
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

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const { created } = await searchParams;
  const [listing, pricing] = await Promise.all([getListing(id), getPublicPricing()]);
  if (!listing) notFound();
  const demo = isDemoSeller(listing.seller.profile?.username);
  const auto = listing.fulfillmentType === 'auto_key';
  const confirmH = pricing?.autoConfirmHours ?? 72;
  const fulfillH = pricing?.fulfillHours ?? 24;

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
      {created && (
        <div className="alert success" role="status" style={{ marginBottom: 20 }}>
          <ShieldCheck size={18} strokeWidth={1.75} />
          <span>
            Лот опубликован и уже виден в каталоге.
            {auto ? ' Загрузите ключи на склад ниже — без них покупка вернёт деньги покупателю.' : ''}
          </span>
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
                : listing.fulfillmentType === 'provider'
                  ? 'Пополнение по игровому ID'
                  : 'Выдаёт продавец'}
            </span>
            {demo && <span className="demo-mark">Пример</span>}
          </div>
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
          {pricing?.paymentsDemo && (
            <p className="hint" style={{ marginTop: 10, textAlign: 'center' }}>
              Демо-оплата: платёжка не подключена, деньги не списываются.
            </p>
          )}

          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            <FavoriteButton listingId={listing.id} />
            <MessageSellerButton listingId={listing.id} />
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
