'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { Attribute } from '@/lib/api';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';
import { BottomSheet } from './bottom-sheet';

const SORTS: Array<[string, string]> = [
  ['new', msg('Сначала поднятые')],
  ['price_asc', msg('Сначала дешёвые')],
  ['price_desc', msg('Сначала дорогие')],
  ['popular', msg('Часто покупают')],
];

/**
 * Фильтры раздела: параметры (звание, регион, сервер), «продавец в сети»,
 * поиск по предложениям и сортировка. Всё живёт в адресе страницы: ссылкой
 * с фильтрами можно поделиться, «назад» в браузере возвращает прежний вид.
 *
 * На телефоне параметры — в шторке за кнопкой «Фильтры» со счётчиком: в
 * строку они занимали пол-экрана до первого предложения.
 */
export function SectionFilters({
  attributes,
  values,
  defaultSort = 'new',
  maxLabel,
}: {
  attributes: Attribute[];
  /** Текущие параметры адреса: f_<ключ>, online, q, max, sort. */
  values: Record<string, string | undefined>;
  /** Сортировка раздела без параметра в адресе: у валюты — сначала дешёвые. */
  defaultSort?: string;
  /** «до 1 500 ₽» — цена из сохранённого поиска; снимается крестиком. */
  maxLabel?: string;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(values.q ?? '');
  const [sheet, setSheet] = useState(false);

  function go(patch: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...values, ...patch })) {
      if (v && k !== 'page') p.set(k, v);
    }
    const s = p.toString();
    router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  function reset() {
    setQ('');
    router.push(values.sort ? `${pathname}?sort=${values.sort}` : pathname, { scroll: false });
  }

  const enums = attributes.filter((a) => a.type === 'enum' && a.options?.length);
  const flags = attributes.filter((a) => a.type === 'bool');
  // Сколько параметров выбрано — на кнопке «Фильтры».
  const chosen =
    Object.keys(values).filter((k) => k.startsWith('f_') && values[k]).length +
    (values.online === '1' ? 1 : 0) +
    (values.max ? 1 : 0);
  const active = chosen > 0 || !!values.q;

  const params = (
    <>
      {enums.map((a) => {
        const v = values[`f_${a.key}`] ?? '';
        return (
          <select
            key={a.key}
            className="input filter-select"
            aria-label={t.d(a.label)}
            data-active={v ? 'true' : undefined}
            value={v}
            onChange={(e) => go({ [`f_${a.key}`]: e.target.value || undefined })}
          >
            <option value="">{t.d(a.label)}</option>
            {(a.options ?? []).map((o) => (
              <option key={o} value={o}>
                {t.d(o)}
              </option>
            ))}
          </select>
        );
      })}
      {flags.map((a) => {
        const on = values[`f_${a.key}`] === '1';
        return (
          <button
            key={a.key}
            type="button"
            className="chip"
            aria-pressed={on}
            onClick={() => go({ [`f_${a.key}`]: on ? undefined : '1' })}
          >
            {t.d(a.label)}
          </button>
        );
      })}
      <button
        type="button"
        className="chip"
        aria-pressed={values.online === '1'}
        onClick={() => go({ online: values.online === '1' ? undefined : '1' })}
      >
        <span className="dot-online" aria-hidden />
        {t('Продавец в сети')}
      </button>
      {values.max && maxLabel && (
        <button
          type="button"
          className="chip"
          aria-pressed
          aria-label={t('Убрать цену {price}', { price: maxLabel })}
          onClick={() => go({ max: undefined })}
        >
          {maxLabel}
          <X size={14} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </>
  );

  return (
    <div className="filters">
      <div className="filters-group filters-inline">{params}</div>
      <div className="filters-group filters-side">
        <form
          role="search"
          className="filter-search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() || undefined });
          }}
        >
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            className="input"
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('Поиск по предложениям')}
            aria-label={t('Поиск по предложениям раздела')}
            maxLength={100}
          />
        </form>
        <button
          type="button"
          className="chip filters-open"
          aria-haspopup="dialog"
          aria-expanded={sheet}
          onClick={() => setSheet(true)}
        >
          <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden />
          {t('Фильтры')}
          {chosen > 0 && <span className="filters-count">{chosen}</span>}
        </button>
        <select
          className="input filter-select"
          aria-label={t('Сортировка')}
          value={values.sort ?? defaultSort}
          onChange={(e) => go({ sort: e.target.value === defaultSort ? undefined : e.target.value })}
        >
          {SORTS.map(([v, label]) => (
            <option key={v} value={v}>
              {t(label)}
            </option>
          ))}
        </select>
        {active && (
          <button type="button" className="btn ghost filter-reset" onClick={reset}>
            {t('Сбросить')}
          </button>
        )}
      </div>

      {sheet && (
        <BottomSheet label={t('Фильтры')} onClose={() => setSheet(false)}>
          <div className="sheet-title">{t('Фильтры')}</div>
          <div className="filters-sheet">{params}</div>
          <div className="filters-sheet-actions">
            {chosen > 0 && (
              <button type="button" className="btn secondary" onClick={reset}>
                {t('Сбросить')}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setSheet(false)}>
              {t('Показать')}
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
