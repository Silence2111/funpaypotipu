import type { MetadataRoute } from 'next';
import { getGames, browseListings } from '@/lib/api';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base: MetadataRoute.Sitemap = [
    { url: SITE, changeFrequency: 'daily', priority: 1 },
  ];
  try {
    const games = (await getGames()) ?? [];
    const gameUrls: MetadataRoute.Sitemap = games.map((g) => ({
      url: `${SITE}/igra/${g.slug}`,
      changeFrequency: 'daily',
      priority: 0.8,
    }));
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
