import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container" style={{ paddingTop: 96, paddingBottom: 96, textAlign: 'center' }}>
      <div style={{ fontSize: 56, marginBottom: 12 }}>🎮</div>
      <h1 className="h1" style={{ fontSize: 34, marginBottom: 8 }}>Страница не найдена</h1>
      <p className="lead" style={{ margin: '0 auto 28px', maxWidth: 440 }}>
        Похоже, этот лот уже купили, а страницу — телепортировали. Но в каталоге ещё много всего.
      </p>
      <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
        <Link href="/catalog" className="btn">В каталог</Link>
        <Link href="/" className="chip">На главную</Link>
      </div>
    </div>
  );
}
