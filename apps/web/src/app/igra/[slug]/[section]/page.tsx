import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getGame } from '@/lib/api';
import { formatPrice, offersCount } from '@/lib/format';
import { SectionView, type SectionSearch } from '@/components/section-view';
import { getT } from '@/lib/i18n/server';

type Params = Promise<{ slug: string; section: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, section } = await params;
  const [game, t] = await Promise.all([getGame(slug), getT()]);
  const cat = game?.categories.find((c) => c.slug === section);
  if (!game || !cat) return { title: t('Раздел не найден') };
  const names = { category: t.d(cat.title), game: t.d(game.title) };
  return {
    title: t('{category} {game} — купить у продавцов', names),
    // Пустой раздел — без «0 предложений» в сниппете и превью ссылки.
    description: !cat.listingCount
      ? t(
          '{category} {game}: покупка у продавцов с рейтингом и отзывами. Деньги у площадки, пока вы не подтвердите получение.',
          names,
        )
      : t(
          '{category} {game}: {offers} от продавцов с рейтингом и отзывами. Деньги у площадки, пока вы не подтвердите получение.',
          {
            ...names,
            // «от 450 ₽, 12 предложений» — цена в сниппете, когда она есть.
            offers: cat.minPrice
              ? `${t('от {price}', { price: formatPrice(cat.minPrice, 'RUB', t) })}, ${offersCount(cat.listingCount, t)}`
              : offersCount(cat.listingCount, t),
          },
        ),
    alternates: { canonical: `/igra/${slug}/${section}` },
    // Пустой раздел не индексируем: сотня пустых страниц на старте — «малоценные»
    // для поиска. С первым лотом запрет снимается сам.
    ...(!cat.listingCount && { robots: { index: false, follow: true } }),
  };
}

export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<SectionSearch>;
}) {
  const { slug, section: sectionSlug } = await params;
  const sp = await searchParams;
  const game = await getGame(slug);
  const section = game?.categories.find((c) => c.slug === sectionSlug);
  if (!game || !section) notFound();
  return <SectionView game={game} section={section} sp={sp} />;
}
