'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/session';

const STATUS: Record<string, { label: string; badge: string; action: string }> = {
  none: { label: 'не пройдена', badge: 'badge', action: 'Пройти проверку' },
  pending: { label: 'на проверке', badge: 'badge warning', action: 'Подробнее' },
  approved: { label: 'документы проверены', badge: 'badge success', action: 'Подробнее' },
  rejected: { label: 'документы не приняты', badge: 'badge danger', action: 'Загрузить заново' },
};

/** Проверка личности в «Безопасности»: статус и переход к документам. */
export function KycCard() {
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<{ status: string }>('/kyc/me')
      .then((k) => setStatus(k.status))
      .catch(() => setStatus('none'));
  }, []);
  const s = status ? (STATUS[status] ?? STATUS.none!) : null;

  return (
    <section className="card" style={{ padding: 24, maxWidth: 600 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="h2 row" style={{ fontSize: 18, gap: 8 }}>
          <ShieldCheck size={18} strokeWidth={1.75} /> Проверка личности
        </h2>
        {s && <span className={s.badge}>{s.label}</span>}
      </div>
      <p className="muted" style={{ fontSize: 14, margin: '8px 0 14px' }}>
        Фото документа и селфи с ним. После проверки — вывод без ограничения суммы и «Документы
        проверены» в профиле.
      </p>
      <Link href="/cabinet/verification" className="btn secondary">
        {s?.action ?? 'Подробнее'}
      </Link>
    </section>
  );
}
