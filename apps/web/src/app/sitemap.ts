import type { MetadataRoute } from 'next';
import { getGameIndex, browseListings } from '@/lib/api';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base: MetadataRoute.Sitemap = [
    { url: SITE, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/igry`, changeFrequency: 'daily', priority: 0.7 },
    { url: `${SITE}/podbor`, changeFrequency: 'weekly', priority: 0.3 },
  ];
  try {
    // Игры и их разделы: «аккаунты CS2» ищут чаще, чем просто «CS2».
    const games = (await getGameIndex()) ?? [];
    const gameUrls: MetadataRoute.Sitemap = games.flatMap((g) => [
      { url: `${SITE}/igra/${g.slug}`, changeFrequency: 'daily' as const, priority: 0.8 },
      ...g.categories.map((c) => ({
        url: `${SITE}/igra/${g.slug}/${c.slug}`,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      })),
    ]);
    const browse = await browseListings({ limit: 60, sort: 'new' });
    const lotUrls: MetadataRoute.Sitemap = (browse?.items ?? []).map((l) => ({
      url: `${SITE}/lot/${l.id}`,
      changeFrequency: 'weekly',
      priority: 0.6,
    }));
    return [...base, ...gameUrls, ...lotUrls];
  } catch {
    return base;
  }
}
