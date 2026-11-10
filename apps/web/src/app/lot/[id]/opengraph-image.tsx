import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getListing } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { getT } from '@/lib/i18n/server';

/**
 * Превью ссылки на лот в Telegram, VK и Discord: название, игра и раздел,
 * цена и продавец. Раньше картинка была только у лотов с фото, а цены в
 * превью не было вовсе — ссылка на лот выглядела как ссылка на сайт.
 */
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'GameMarket';

// Шрифт с кириллицей и знаком ₽: встроенный в next/og — только латиница.
const FONTS = join(process.cwd(), 'node_modules/@fontsource/inter/files');
let fonts: Promise<Array<{ name: string; data: Buffer; weight: 400 | 700; style: 'normal' }>> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all(
    (['latin', 'latin-ext', 'cyrillic'] as const).flatMap((subset) =>
      ([400, 700] as const).map(async (weight) => ({
        // ₽ — в latin-ext, а сам генератор до него не доходит, если набор
        // назван тем же именем: отдельное имя — запасным в font-family.
        name: subset === 'latin-ext' ? 'InterExt' : 'Inter',
        data: await readFile(join(FONTS, `inter-${subset}-${weight}-normal.woff`)),
        weight,
        style: 'normal' as const,
      })),
    ),
  ));

export default async function LotImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [listing, t, font] = await Promise.all([getListing(id), getT(), loadFonts()]);
  const price = !listing
    ? null
    : listing.topupMarkupBps != null && listing.topupMin
      ? t('от {price}', { price: formatPrice(listing.topupMin, listing.currency, t) })
      : listing.unitName && (listing.pricePerUnits ?? 1) > 1
        ? `${formatPrice(listing.price, listing.currency, t)} · ${listing.pricePerUnits} ${t.d(listing.unitName)}`
        : formatPrice(listing.price, listing.currency, t);
  const seller = listing?.seller.profile;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#f4f5f8', padding: 64, fontFamily: 'Inter, InterExt', color: '#0b0c0f' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, fontWeight: 700 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#2563eb', display: 'flex' }} />
          GameMarket
        </div>
        {listing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ fontSize: 30, color: '#5b5f6b' }}>{`${t.d(listing.game.title)} · ${t.d(listing.category.title)}`}</div>
            <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.1, display: 'flex', maxHeight: 140, overflow: 'hidden' }}>{listing.title}</div>
            <div style={{ fontSize: 76, fontWeight: 700, color: '#2563eb' }}>{price}</div>
          </div>
        ) : (
          <div style={{ fontSize: 56, fontWeight: 700 }}>{t('Лот не найден')}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26, color: '#5b5f6b' }}>
          <span>
            {seller
              ? seller.ratingCount
                ? t('Продавец {name} · ★ {rating}', { name: seller.username, rating: seller.ratingAvg.toFixed(1) })
                : t('Продавец {name}', { name: seller.username })
              : ''}
          </span>
          <span>{t('Деньги у площадки до подтверждения')}</span>
        </div>
      </div>
    ),
    { ...size, fonts: await font },
  );
}
