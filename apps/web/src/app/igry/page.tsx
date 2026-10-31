import type { Metadata } from 'next';
import Link from 'next/link';
import { getGameIndex, KIND_LABELS, type GameIndexEntry } from '@/lib/api';
import { GameSearch } from '@/components/game-search';
import { GameDirectory } from '@/components/game-directory';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Все игры и сервисы от А до Я'),
    description: t('Игры, мобильные игры и сервисы с разделами: аккаунты, валюта, предметы, ключи, донат и услуги.'),
    alternates: { canonical: '/igry' },
  };
}

const KINDS = Object.keys(KIND_LABELS) as Array<GameIndexEntry['kind']>;

/** Указатель игр, как у FunPay: от А до Я, у каждой — её разделы. */
export default async function GamesIndexPage({ searchParams }: { searchParams: Promise<{ vid?: string }> }) {
  const { vid } = await searchParams;
  const t = await getT();
  const kind = KINDS.find((k) => k === vid);
  const all = (await getGameIndex()) ?? [];
  const games = kind ? all.filter((g) => g.kind === kind) : all;

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 24 }}>
      <h1 className="h1" style={{ fontSize: 34 }}>
        {kind ? t(KIND_LABELS[kind]) : t('Все игры')}
      </h1>
      <p className="muted" style={{ marginTop: 8 }}>
        {t('{n} — от А до Я, с разделами.', { n: games.length })}
      </p>

      <div style={{ marginTop: 24, maxWidth: 640 }}>
        <GameSearch index={all} size="lg" />
      </div>

      <nav className="kind-links" aria-label={t('Что показать')} style={{ marginTop: 20 }}>
        <Link href="/igry" className="chip" aria-current={!kind ? 'page' : undefined}>
          {t('Все')}
        </Link>
        {KINDS.map((k) => (
          <Link key={k} href={`/igry?vid=${k}`} className="chip" aria-current={kind === k ? 'page' : undefined}>
            {t(KIND_LABELS[k])}
          </Link>
        ))}
      </nav>

      <div style={{ marginTop: 32 }}>
        {games.length > 0 ? (
          <GameDirectory games={games} />
        ) : (
          <p className="muted">{t('Каталог пока собирается.')}</p>
        )}
      </div>
    </div>
  );
}
