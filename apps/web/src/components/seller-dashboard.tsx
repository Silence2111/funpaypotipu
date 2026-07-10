'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, Package, Clock, Star } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import type { SellerDashboard as Dash } from '@/lib/api';

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row faint" style={{ gap: 6, fontSize: 12 }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 6 }}>{value}</div>
    </div>
  );
}

export function SellerDashboard() {
  const [d, setD] = useState<Dash | null>(null);

  useEffect(() => {
    apiFetch<Dash>('/sellers/me/dashboard').then(setD).catch(() => {});
  }, []);

  if (!d) return null;
  // Показываем дашборд только состоявшимся продавцам (есть продажи или лоты).
  if (d.salesCount === 0 && d.activeListings === 0 && d.inProgress === 0) return null;

  const max = Math.max(1, ...d.revenueSeries);

  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>Аналитика продавца</h2>
        <span className="badge">{d.level.label}</span>
      </div>

      <div className="grid cols-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <Kpi icon={<TrendingUp size={14} />} label="Выручка всего" value={formatPrice(d.revenueTotal, 'RUB')} />
        <Kpi icon={<TrendingUp size={14} />} label="Выручка за 30 дней" value={formatPrice(d.revenue30, 'RUB')} />
        <Kpi icon={<Package size={14} />} label="Продаж всего" value={String(d.salesCount)} />
        <Kpi icon={<Clock size={14} />} label="В работе" value={String(d.inProgress)} />
        <Kpi icon={<Package size={14} />} label="Активных лотов" value={String(d.activeListings)} />
        <Kpi icon={<Star size={14} />} label="Рейтинг"
          value={d.ratingCount > 0 ? `${d.ratingAvg.toFixed(1)} · ${d.ratingCount}` : '—'} />
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <div className="faint" style={{ fontSize: 12, marginBottom: 10 }}>Выручка по дням (14 дней)</div>
        <div className="row" style={{ gap: 4, alignItems: 'flex-end', height: 64 }}>
          {d.revenueSeries.map((v, i) => (
            <div key={i} title={formatPrice(String(v), 'RUB')}
              style={{
                flex: 1, height: `${Math.max(3, Math.round((v / max) * 100))}%`,
                background: v > 0 ? 'var(--accent)' : 'var(--bg-subtle)',
                borderRadius: 3, minHeight: 3,
              }} />
          ))}
        </div>
      </div>
    </section>
  );
}
