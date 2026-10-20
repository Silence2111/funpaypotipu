'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { saveLang, useT } from '@/lib/i18n/client';
import { LANG_NAMES, isLang } from '@/lib/i18n/lang';

/**
 * Язык сайта: русский или английский. Названия языков — на самих языках,
 * чтобы их узнал тот, кто не читает текущий. Выбор запоминается в cookie,
 * сервер перерисовывает страницу на новом языке без перезагрузки.
 */
export function LangSwitch({ className, label }: { className?: string; label?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  const select = (
    <select
      className={`chip ${className ?? ''}`}
      aria-label={t('Язык сайта')}
      value={t.lang}
      disabled={pending}
      onChange={(e) => {
        if (!isLang(e.target.value)) return;
        saveLang(e.target.value);
        start(() => router.refresh());
      }}
      style={{ paddingRight: 10, appearance: 'auto' }}
    >
      {Object.entries(LANG_NAMES).map(([code, name]) => (
        <option key={code} value={code} lang={code}>
          {name}
        </option>
      ))}
    </select>
  );
  return label ? (
    <label className="row faint" style={{ gap: 8, fontSize: 13 }}>
      <Languages size={16} strokeWidth={1.75} aria-hidden /> {select}
    </label>
  ) : (
    select
  );
}
