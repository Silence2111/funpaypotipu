import { apiGet } from '@/lib/api';

type Health = { status: string; db: string; ts: string };

async function getHealth(): Promise<Health | null> {
  try {
    return await apiGet<Health>('/health');
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const health = await getHealth();

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '48px 24px' }}>
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>GameMarket</h1>
      <p style={{ opacity: 0.8, fontSize: 18 }}>
        Маркетплейс цифровых игровых товаров с эскроу-защитой сделки.
      </p>

      <section
        style={{
          marginTop: 32,
          padding: 16,
          border: '1px solid #2a2f37',
          borderRadius: 12,
          background: '#161a20',
        }}
      >
        <h2 style={{ fontSize: 18, marginTop: 0 }}>Статус системы</h2>
        {health ? (
          <ul style={{ lineHeight: 1.8 }}>
            <li>API: <b style={{ color: '#5fd38d' }}>{health.status}</b></li>
            <li>База данных: <b>{health.db}</b></li>
          </ul>
        ) : (
          <p style={{ color: '#ff7a7a' }}>
            API недоступен — запустите <code>pnpm --filter @gamemarket/api dev</code>.
          </p>
        )}
      </section>

      <p style={{ marginTop: 32, opacity: 0.6 }}>
        Фаза 0 — фундамент. Каталог, лоты и сделки появятся в следующих фазах
        (см. docs/11-roadmap.md).
      </p>
    </main>
  );
}
