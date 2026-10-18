import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getGame } from '@/lib/api';
import { offersCount, SectionView, type SectionSearch } from '@/components/section-view';

type Params = Promise<{ slug: string; section: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, section } = await params;
  const game = await getGame(slug);
  const cat = game?.categories.find((c) => c.slug === section);
  if (!game || !cat) return { title: 'Раздел не найден' };
  return {
    title: `${cat.title} ${game.title} — купить у продавцов`,
    description: `${cat.title} ${game.title}: ${offersCount(cat.listingCount ?? 0)} от продавцов с рейтингом и отзывами. Деньги у площадки, пока вы не подтвердите получение.`,
    alternates: { canonical: `/igra/${slug}/${section}` },
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
