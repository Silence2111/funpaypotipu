'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { apiFetch, useSession } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

export interface ConsentStatus {
  version: string;
  active: { version: string; method: string; givenAt: string; current: boolean } | null;
  history: Array<{ version: string; method: string; givenAt: string; revokedAt: string | null }>;
}

const METHOD: Record<string, string> = {
  email: msg('при регистрации по почте'),
  yandex: msg('при входе через Яндекс ID'),
  vk: msg('при входе через VK ID'),
  telegram: msg('при входе через Telegram'),
  account: msg('в кабинете'),
};

/**
 * Согласие на обработку ПД в настройках (часть 120): когда и как дано,
 * отзыв с подтверждением, согласие заново.
 */
export function ConsentSettings() {
  const t = useT();
  const [s, setS] = useState<ConsentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    apiFetch<ConsentStatus>('/account/consent')
      .then(setS)
      .catch(() => setNote({ ok: false, text: t('Не удалось загрузить согласие.') }));
  }, [t]);

  async function act(path: '/account/consent' | '/account/consent/revoke') {
    setBusy(true);
    setNote(null);
    try {
      const next = await apiFetch<ConsentStatus>(path, { method: 'POST' });
      setS(next);
      setConfirm(false);
      setNote({
        ok: true,
        text: next.active
          ? t('Согласие дано — спасибо.')
          : t(
              'Согласие отозвано. Подборки и предложения больше не придут. Через 30 дней уничтожим имя на витрине, «о себе», аватар, историю входов, сохранённые поиски и подписки, если не дадите согласие снова. Сделки, деньги и вход по почте остаются — это договор и закон.',
            ),
      });
      window.dispatchEvent(new Event('gm-consent'));
    } catch (e) {
      setNote({ ok: false, text: apiErrorMessage(e, t('Не получилось. Попробуйте ещё раз.')) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ maxWidth: 600 }} aria-labelledby="consent-title">
      <h2 className="h2" id="consent-title" style={{ fontSize: 18, marginBottom: 6 }}>
        {t('Согласие на обработку персональных данных')}
      </h2>
      {s === null ? (
        !note && <div className="skeleton" style={{ height: 60 }} aria-busy="true" />
      ) : (
        <div className="card" style={{ padding: 16, display: 'grid', gap: 10 }}>
          {s.active ? (
            <p style={{ margin: 0 }}>
              <span className="badge success">{t('дано')}</span>{' '}
              {t('{date}, {how}', {
                date: new Date(s.active.givenAt).toLocaleDateString(t.locale),
                how: t(METHOD[s.active.method] ?? s.active.method),
              })}
              {!s.active.current && <span className="faint"> · {t('по прежней редакции')}</span>}
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              <span className="badge warning">{t('не дано')}</span>{' '}
              {t('Без согласия мы обрабатываем только то, без чего не исполнить сделки и требования закона.')}
            </p>
          )}
          <p className="hint" style={{ margin: 0 }}>
            <Link href="/soglasie" style={{ color: 'var(--accent)' }}>
              {t('Текст согласия')}
            </Link>{' '}
            · {t('редакция от {v}', { v: s.version.split('-').reverse().join('.') })}
          </p>
          {note && (
            <div className={note.ok ? 'alert success' : 'alert error'} role={note.ok ? 'status' : 'alert'}>
              {note.text}
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {(!s.active || !s.active.current) && (
              <button type="button" className="btn" disabled={busy} onClick={() => void act('/account/consent')}>
                {t('Даю согласие')}
              </button>
            )}
            {s.active &&
              (confirm ? (
                <>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => void act('/account/consent/revoke')}>
                    {t('Да, отозвать')}
                  </button>
                  <button type="button" className="chip" onClick={() => setConfirm(false)}>
                    {t('Отмена')}
                  </button>
                </>
              ) : (
                <button type="button" className="chip" onClick={() => setConfirm(true)}>
                  {t('Отозвать согласие')}
                </button>
              ))}
          </div>
          {confirm && (
            <p className="hint" style={{ margin: 0 }}>
              {t(
                'Отзыв записывается с датой. Подборки и предложения перестанут приходить сразу, а через 30 дней уничтожим то, что обрабатывали только по согласию: имя на витрине, «о себе», аватар, историю входов, поиски и подписки. Сделки, расчёты и вход останутся.',
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Плашка для вошедших без действующего согласия: аккаунты до части 120,
 * после отзыва и после новой редакции текста. «Позже» — до конца сеанса.
 */
export function ConsentBanner() {
  const t = useT();
  const { ready, user } = useSession();
  const path = usePathname();
  const userId = user?.id;
  const [need, setNeed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || !userId) {
      setNeed(false);
      return;
    }
    let hidden = false;
    try {
      hidden = sessionStorage.getItem('gm_consent_later') === '1';
    } catch {
      // приватный режим — плашка просто покажется
    }
    if (hidden) return;
    const check = () =>
      apiFetch<ConsentStatus>('/account/consent')
        .then((s) => setNeed(!s.active?.current))
        .catch(() => {});
    void check();
    window.addEventListener('gm-consent', check);
    return () => window.removeEventListener('gm-consent', check);
  }, [ready, userId]);

  // Сама страница согласия и настройки — без плашки: там всё уже есть.
  if (!need || path === '/soglasie' || path === '/cabinet/settings') return null;

  async function give() {
    setBusy(true);
    try {
      const s = await apiFetch<ConsentStatus>('/account/consent', { method: 'POST' });
      setNeed(!s.active?.current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ marginTop: 12 }}>
      <div className="alert consent-banner" role="region" aria-label={t('Согласие на обработку персональных данных')}>
        <ShieldCheck size={18} strokeWidth={1.75} aria-hidden />
        <span>
          {t('Подтвердите согласие на обработку персональных данных — теперь оно оформляется отдельно от оферты.')}{' '}
          <Link href="/soglasie" style={{ color: 'var(--accent)' }}>
            {t('Текст согласия')}
          </Link>
        </span>
        <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" disabled={busy} onClick={() => void give()}>
            {t('Даю согласие')}
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => {
              try {
                sessionStorage.setItem('gm_consent_later', '1');
              } catch {
                // не запомнили — покажем снова на следующей странице
              }
              setNeed(false);
            }}
          >
            {t('Позже')}
          </button>
        </span>
      </div>
    </div>
  );
}
