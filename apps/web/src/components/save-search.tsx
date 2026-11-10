'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, Check } from 'lucide-react';
import { sameSearch } from '@gamemarket/shared/saved-search';
import type { SavedSearch } from '@/lib/api';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

/**
 * «Сохранить поиск» под фильтрами раздела: условия раздела, «цена до» и
 * уведомления о новых предложениях. Сохранённый поиск — отметка со ссылкой
 * на «Мои поиски». Цена из панели попадает в адрес страницы: раздел сразу
 * показывает то, о чём будут приходить уведомления.
 */
export function SaveSearch({
  categoryId,
  attrs,
  q,
  maxRub,
  summary,
}: {
  categoryId: string;
  attrs: Record<string, string | boolean>;
  q: string | null;
  /** «Цена до» из адреса, в рублях. */
  maxRub: number | null;
  /** Условия словами: «Звание: Global Elite», «Prime», «нож». */
  summary: string[];
}) {
  const t = useT();
  const router = useRouter();
  const [saved, setSaved] = useState<SavedSearch | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(maxRub ? String(maxRub) : '');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const maxPrice = maxRub ? String(maxRub * 100) : null;
  const key = JSON.stringify([categoryId, attrs, q, maxPrice]);

  useEffect(() => {
    setPrice(maxRub ? String(maxRub) : '');
    if (!getToken()) {
      setSaved(null);
      return;
    }
    const filters = { categoryId, attrs, q, maxPrice };
    apiFetch<SavedSearch[]>('/saved-searches')
      .then((list) => setSaved(list.find((s) => sameSearch(s, filters)) ?? null))
      .catch(() => setSaved(null));
    // key — те же условия одной строкой: объект attrs новый при каждой отрисовке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function start() {
    if (!getToken()) {
      router.push(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    setErr(null);
    setOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const rub = price.trim() ? Number(price.replace(/\s/g, '')) : null;
    if (rub !== null && !(Number.isInteger(rub) && rub > 0)) {
      setErr(t('Цена — целым числом рублей больше нуля.'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const s = await apiFetch<SavedSearch>('/saved-searches', {
        method: 'POST',
        body: JSON.stringify({ categoryId, attrs, q, maxPrice: rub ? rub * 100 : null, notify }),
      });
      setSaved(s);
      setOpen(false);
      // Другая цена — раздел показывает ровно то, что будет приходить.
      if (s.path && rub !== maxRub) router.replace(s.path, { scroll: false });
    } catch (er) {
      setErr(apiErrorMessage(er, t('Не удалось сохранить поиск.')));
    } finally {
      setBusy(false);
    }
  }

  if (saved === undefined) return null;
  if (saved) {
    return (
      <Link href="/cabinet/searches" className="chip save-search-done">
        <Check size={16} strokeWidth={1.75} aria-hidden />
        {saved.notify ? t('Поиск сохранён, уведомления включены') : t('Поиск сохранён')}
      </Link>
    );
  }
  if (!open) {
    return (
      <button type="button" className="chip" onClick={start}>
        <Bell size={16} strokeWidth={1.75} aria-hidden />
        {t('Сохранить поиск')}
      </button>
    );
  }
  return (
    <form className="card save-search" onSubmit={save} aria-label={t('Сохранить поиск')}>
      <div className="save-search-title">{t('Сохранить поиск')}</div>
      <div className="save-search-terms">
        {summary.length ? (
          summary.map((s) => (
            <span key={s} className="badge">
              {s}
            </span>
          ))
        ) : (
          <span className="faint">{t('Все предложения раздела')}</span>
        )}
      </div>
      <label className="field">
        <span className="label">{t('Цена до, ₽')}</span>
        <input
          className="input save-search-price"
          inputMode="numeric"
          enterKeyHint="done"
          value={price}
          placeholder={t('Без предела')}
          maxLength={9}
          onChange={(e) => setPrice(e.target.value.replace(/[^\d\s]/g, ''))}
        />
      </label>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={notify}
        onClick={() => setNotify(!notify)}
      >
        <span className="switch-track" aria-hidden>
          <span className="switch-thumb" />
        </span>
        <span className="switch-label">{t('Уведомлять о новых предложениях')}</span>
      </button>
      <p className="hint" style={{ margin: 0 }}>
        {t(
          'Новый подходящий лот придёт уведомлением — на сайте, в Telegram или пушем, как настроено в уведомлениях. О каждом лоте — один раз.',
        )}
      </p>
      {err && <p className="field-error">{err}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" type="submit" disabled={busy}>
          {t('Сохранить')}
        </button>
        <button className="chip" type="button" onClick={() => setOpen(false)}>
          {t('Отмена')}
        </button>
      </div>
    </form>
  );
}
