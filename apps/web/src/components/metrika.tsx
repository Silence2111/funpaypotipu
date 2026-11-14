'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/client';

const COUNTER = Number(process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID ?? 0);
const KEY = 'gm_cookies';

type Ym = (id: number, method: string, ...args: unknown[]) => void;
declare global {
  interface Window {
    ym?: Ym & { a?: unknown[]; l?: number };
  }
}

function readChoice(): 'yes' | 'no' | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'yes' || v === 'no' ? v : null;
  } catch {
    return null;
  }
}

/** Счётчик Метрики — тот же код, что выдаёт Метрика, только без вебвизора. */
function loadMetrika() {
  if (window.ym) return;
  const ym = function (...args: unknown[]) {
    (ym.a = ym.a ?? []).push(args);
  } as unknown as NonNullable<Window['ym']>;
  ym.l = Date.now();
  window.ym = ym;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.appendChild(s);
  ym(COUNTER, 'init', {
    clickmap: true,
    trackLinks: true,
    accurateTrackBounce: true,
    webvisor: false,
    defer: true,
  });
}

/** Сбросить выбор о cookie: плашка покажется снова (ссылка в «Персональных данных»). */
export function resetCookieChoice() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* хранилище недоступно — выбора и не было */
  }
  window.location.reload();
}

/**
 * Яндекс Метрика (часть 131): включается номером счётчика владельца
 * (NEXT_PUBLIC_YANDEX_METRIKA_ID), без него — ни счётчика, ни плашки.
 * Счётчик грузится только после «Разрешить»: Метрика ставит cookie, а это
 * данные человека (152-ФЗ). «Отказаться» — и счётчика нет. Переходы по
 * сайту без перезагрузки отправляются в Метрику сами.
 */
export function Metrika() {
  const t = useT();
  const path = usePathname();
  const [choice, setChoice] = useState<'yes' | 'no' | null | undefined>(undefined);

  useEffect(() => {
    if (COUNTER) setChoice(readChoice());
  }, []);

  useEffect(() => {
    if (choice !== 'yes') return;
    const first = !window.ym;
    loadMetrika();
    if (!first) window.ym?.(COUNTER, 'hit', window.location.href);
  }, [choice, path]);

  if (!COUNTER || choice !== null) return null;
  const decide = (v: 'yes' | 'no') => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* без хранилища выбор живёт до перезагрузки */
    }
    setChoice(v);
  };
  return (
    <div className="cookie-banner" role="region" aria-label={t('Файлы cookie')}>
      <p>
        {t(
          'Мы используем Яндекс Метрику, чтобы понимать, что на сайте неудобно. Она ставит файлы cookie — только если вы разрешите.',
        )}{' '}
        <Link href="/privacy">{t('Подробнее')}</Link>
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn" onClick={() => decide('yes')}>
          {t('Разрешить')}
        </button>
        <button type="button" className="btn secondary" onClick={() => decide('no')}>
          {t('Отказаться')}
        </button>
      </div>
    </div>
  );
}

/** «Изменить выбор о cookie» — на странице «Персональные данные». */
export function CookieChoiceButton() {
  const t = useT();
  if (!COUNTER) return null;
  return (
    <button type="button" className="btn secondary" onClick={resetCookieChoice}>
      {t('Изменить выбор о файлах cookie')}
    </button>
  );
}
