'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { saveLang, useT } from '@/lib/i18n/client';
import { LANG_NAMES, isLang, type Lang } from '@/lib/i18n/lang';
import { apiFetch, getToken } from '@/lib/session';

/**
 * Вошедшему — тот же язык в профиль: на нём придут письма, Telegram и пуши.
 * Настройки уведомлений узнают о смене событием gm-locale.
 */
function saveToProfile(lang: Lang) {
  if (!getToken()) return;
  void apiFetch('/account/locale', { method: 'PUT', body: JSON.stringify({ locale: lang }) })
    .then(() => window.dispatchEvent(new CustomEvent('gm-locale', { detail: lang })))
    .catch(() => {
      /* не вошёл или нет связи — язык придёт со следующим входом */
    });
}

/**
 * Язык сайта: русский или английский. Названия языков — на самих языках,
 * чтобы их узнал тот, кто не читает текущий. Выбор запоминается в cookie
 * и в профиле, сервер перерисовывает страницу на новом языке без перезагрузки.
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
        saveToProfile(e.target.value);
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
