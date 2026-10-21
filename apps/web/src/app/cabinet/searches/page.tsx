'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SavedSearch } from '@/lib/api';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { CabinetNav } from '@/components/cabinet-nav';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';

/** Условия поиска словами: «Звание: Global Elite», «Prime», «нож», «до 1 500 ₽». */
function terms(s: SavedSearch, t: T): string[] {
  return [
    ...Object.entries(s.attrs).map(([k, v]) => {
      const label = t.d(s.labels[k] ?? k);
      return v === true ? label : `${label}: ${t.d(String(v))}`;
    }),
    ...(s.q ? [t('«{q}»', { q: s.q })] : []),
    ...(s.maxPrice ? [t('до {price}', { price: formatPrice(s.maxPrice, 'RUB', t) })] : []),
  ];
}

/**
 * «Мои поиски»: сохранённые в разделах условия, уведомления по каждому,
 * ссылка на раздел с теми же условиями. Сохраняют — кнопкой под фильтрами
 * раздела.
 */
export default function SearchesPage() {
  const t = useT();
  const router = useRouter();
  const [list, setList] = useState<SavedSearch[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setList(await apiFetch<SavedSearch[]>('/saved-searches'));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/searches');
      return;
    }
    load().catch(() => setMsg({ ok: false, text: t('Не удалось загрузить поиски.') }));
  }, [router, load, t]);

  async function toggle(s: SavedSearch) {
    setBusy(s.id);
    setMsg(null);
    try {
      const r = await apiFetch<SavedSearch>(`/saved-searches/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ notify: !s.notify }),
      });
      setList((l) => l?.map((x) => (x.id === r.id ? r : x)) ?? null);
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, t('Не удалось сохранить.')) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(s: SavedSearch) {
    setBusy(s.id);
    setMsg(null);
    try {
      await apiFetch(`/saved-searches/${s.id}`, { method: 'DELETE' });
      setList((l) => l?.filter((x) => x.id !== s.id) ?? null);
      setMsg({ ok: true, text: t('Поиск удалён.') });
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, t('Не удалось удалить поиск.')) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Поиски')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t(
            'Условия, сохранённые в разделах. Когда выставят подходящий лот, придёт уведомление — о каждом лоте один раз.',
          )}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {msg && (
        <div
          className={msg.ok ? 'alert success' : 'alert error'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </div>
      )}

      {list === null ? (
        <div className="skeleton" style={{ height: 240 }} aria-busy="true" />
      ) : list.length === 0 ? (
        <div className="card flat empty-state">
          <p className="muted" style={{ maxWidth: '60ch' }}>
            {t(
              'Сохранённых поисков нет. Откройте раздел игры, выберите фильтры и нажмите «Сохранить поиск» — новые предложения придут уведомлением.',
            )}
          </p>
          <Link href="/igry" className="btn secondary">
            {t('Все игры')}
          </Link>
        </div>
      ) : (
        <ul className="searches">
          {list.map((s) => (
            <li key={s.id} className="card searches-item">
              <div className="searches-main">
                <div className="searches-title">
                  {s.game ? `${t.d(s.game.title)} · ` : ''}
                  {t.d(s.category.title)}
                </div>
                <div className="save-search-terms">
                  {terms(s, t).length ? (
                    terms(s, t).map((x) => (
                      <span key={x} className="badge">
                        {x}
                      </span>
                    ))
                  ) : (
                    <span className="faint">{t('Все предложения раздела')}</span>
                  )}
                </div>
                {s.lastHitAt && (
                  <div className="hint">
                    {t('Последний новый лот — {date}', {
                      date: new Date(s.lastHitAt).toLocaleString(t.locale, {
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                    })}
                  </div>
                )}
              </div>
              <div className="searches-actions">
                <button
                  type="button"
                  role="switch"
                  className="switch"
                  aria-checked={s.notify}
                  aria-label={t('Уведомлять о новых предложениях')}
                  disabled={busy === s.id}
                  onClick={() => void toggle(s)}
                >
                  <span className="switch-track" aria-hidden>
                    <span className="switch-thumb" />
                  </span>
                  <span className="switch-label" aria-hidden>
                    {s.notify ? t('Уведомления включены') : t('Без уведомлений')}
                  </span>
                </button>
                <div className="row" style={{ gap: 6 }}>
                  {s.path && (
                    <Link href={s.path} className="chip">
                      {t('Открыть')}
                    </Link>
                  )}
                  <button
                    type="button"
                    className="chip"
                    disabled={busy === s.id}
                    onClick={() => void remove(s)}
                  >
                    {t('Удалить')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
