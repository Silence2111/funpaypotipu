'use client';

import { Star } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

/** Цвет звезды — токен warning из системы, один на весь сайт. */
const STAR = '#E8A317';

export function Stars({ n, size = 13 }: { n: number; size?: number }) {
  const t = useT();
  return (
    <span className="row" style={{ gap: 1 }} aria-label={t('{n} из 5', { n })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} strokeWidth={1.75} fill={i <= n ? STAR : 'none'} color={i <= n ? STAR : 'var(--fg-faint)'} />
      ))}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const t = useT();
  return (
    <div className="row" style={{ gap: 4 }} role="radiogroup" aria-label={t('Оценка')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          aria-label={t('{n} из 5', { n })}
          onClick={() => onChange(n)}
          style={{ background: 'none', border: 0, cursor: 'pointer', padding: 10, lineHeight: 0 }}
        >
          <Star size={24} strokeWidth={1.75} fill={n <= value ? STAR : 'none'} color={n <= value ? STAR : 'var(--fg-faint)'} />
        </button>
      ))}
    </div>
  );
}
