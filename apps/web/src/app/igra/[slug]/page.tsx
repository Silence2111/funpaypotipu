import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getGame } from '@/lib/api';
import { defaultSection, SectionView, type SectionSearch } from '@/components/section-view';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const game = await getGame(slug);
  if (!game) return { title: 'Игра не найдена' };
  const sections = game.categories.map((c) => c.title.toLowerCase()).join(', ');
  return {
    title: `${game.title} — купить у продавцов`,
    description: `${game.title}: ${sections || 'предложения продавцов'}. Деньги у площадки, пока вы не подтвердите получение.`,
    alternates: { canonical: `/igra/${slug}` },
  };
}

/**
 * Страница игры открывает её первый раздел с предложениями — как FunPay и
 * Playerok: у игры нет отдельной витрины, есть разделы.
 */
export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SectionSearch>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const game = await getGame(slug);
  if (!game) notFound();

  // Старые ссылки «/igra/cs2?category=accounts» ведут на адрес раздела.
  if (sp.category) {
    const rest = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== 'category') rest.set(k, v);
    const s = rest.toString();
    redirect(`/igra/${slug}/${encodeURIComponent(sp.category)}${s ? `?${s}` : ''}`);
  }

  const section = defaultSection(game);
  if (!section) {
    return (
      <div className="container" style={{ paddingTop: 40 }}>
        <Link href="/igry" className="faint back-link" style={{ fontSize: 14 }}>
          ← Все игры
        </Link>
        <h1 className="h1" style={{ fontSize: 34, marginTop: 12 }}>
          {game.title}
        </h1>
        <p className="muted">Разделов у игры пока нет.</p>
      </div>
    );
  }
  return <SectionView game={game} section={section} sp={sp} />;
}
