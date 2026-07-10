import Link from 'next/link';
import { ShieldCheck, MessagesSquare, Zap } from 'lucide-react';
import { getGames, browseListings } from '@/lib/api';
import { GameCardView, ListingCardView } from '@/components/cards';

export default async function HomePage() {
  const [games, browse, instantBrowse] = await Promise.all([
    getGames(),
    browseListings({ limit: 8, sort: 'new' }),
    browseListings({ limit: 8, instant: true, sort: 'popular' }),
  ]);
  const listings = browse?.items ?? [];
  const instant = instantBrowse?.items ?? [];

  return (
    <div className="container stack-lg" style={{ paddingTop: 72 }}>
      {/* Hero */}
      <section style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto' }}>
        <h1 className="h1">Игровые товары. Безопасно.</h1>
        <p className="lead">
          Аккаунты, валюта, предметы, ключи и пополнения — с эскроу-защитой каждой сделки.
        </p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 28, gap: 12 }}>
          <Link href="#games" className="btn">
            Выбрать игру
          </Link>
          <Link href="#how" className="btn ghost">
            Как это работает
          </Link>
        </div>
      </section>

      {/* Trust */}
      <section id="how" className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {[
          { icon: ShieldCheck, t: 'Эскроу-защита', d: 'Деньги у площадки, пока вы не подтвердите получение.' },
          { icon: MessagesSquare, t: 'Чат со сделкой', d: 'Общение с продавцом и вся история в одном месте.' },
          { icon: Zap, t: 'Быстрая выдача', d: 'Ключи и пополнения — автоматически после оплаты.' },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="card">
            <Icon size={22} strokeWidth={1.5} />
            <div style={{ fontWeight: 600, margin: '12px 0 6px' }}>{t}</div>
            <div className="muted" style={{ fontSize: 14 }}>{d}</div>
          </div>
        ))}
      </section>

      {/* Instant delivery */}
      {instant.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={20} strokeWidth={1.75} /> Мгновенная выдача
            </h2>
            <Link href="/catalog" className="muted" style={{ fontSize: 14 }}>Все →</Link>
          </div>
          <p className="muted" style={{ fontSize: 14, marginTop: -8, marginBottom: 16 }}>
            Ключи и пополнения приходят автоматически сразу после оплаты · +2% кэшбэк на баланс
          </p>
          <div className="grid cols-auto">
            {instant.map((l) => (
              <ListingCardView key={l.id} listing={l} />
            ))}
          </div>
        </section>
      )}

      {/* Games */}
      <section id="games">
        <div className="section-head">
          <h2 className="h2">Игры</h2>
        </div>
        {games && games.length > 0 ? (
          <div className="grid cols-auto">
            {games.map((g) => (
              <GameCardView key={g.id} game={g} />
            ))}
          </div>
        ) : (
          <EmptyHint />
        )}
      </section>

      {/* Recent listings */}
      <section>
        <div className="section-head">
          <h2 className="h2">Новые лоты</h2>
          <Link href="/catalog" className="muted" style={{ fontSize: 14 }}>
            Все →
          </Link>
        </div>
        {listings.length > 0 ? (
          <div className="grid cols-auto">
            {listings.map((l) => (
              <ListingCardView key={l.id} listing={l} />
            ))}
          </div>
        ) : (
          <EmptyHint />
        )}
      </section>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
      <p className="muted" style={{ margin: 0 }}>
        Пока пусто. Запустите API и БД, затем выполните <code>pnpm db:seed</code>.
      </p>
    </div>
  );
}
