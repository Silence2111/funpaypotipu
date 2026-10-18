'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import type { Attribute } from '@/lib/api';

const SORTS: Array<[string, string]> = [
  ['new', 'Сначала поднятые'],
  ['price_asc', 'Сначала дешёвые'],
  ['price_desc', 'Сначала дорогие'],
  ['popular', 'Часто покупают'],
];

/**
 * Фильтры раздела: параметры (звание, регион, сервер), «продавец в сети»,
 * поиск по предложениям и сортировка. Всё живёт в адресе страницы: ссылкой
 * с фильтрами можно поделиться, «назад» в браузере возвращает прежний вид.
 */
export function SectionFilters({
  attributes,
  values,
}: {
  attributes: Attribute[];
  /** Текущие параметры адреса: f_<ключ>, online, q, sort. */
  values: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(values.q ?? '');

  function go(patch: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...values, ...patch })) {
      if (v && k !== 'page') p.set(k, v);
    }
    const s = p.toString();
    router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  const enums = attributes.filter((a) => a.type === 'enum' && a.options?.length);
  const flags = attributes.filter((a) => a.type === 'bool');
  const active =
    Object.keys(values).some((k) => k.startsWith('f_') && values[k]) ||
    values.online === '1' ||
    !!values.q;

  return (
    <div className="filters">
      <div className="filters-group">
        {enums.map((a) => {
          const v = values[`f_${a.key}`] ?? '';
          return (
            <select
              key={a.key}
              className="input filter-select"
              aria-label={a.label}
              data-active={v ? 'true' : undefined}
              value={v}
              onChange={(e) => go({ [`f_${a.key}`]: e.target.value || undefined })}
            >
              <option value="">{a.label}</option>
              {(a.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
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
              {a.label}
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
          Продавец в сети
        </button>
      </div>
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
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по предложениям"
            aria-label="Поиск по предложениям раздела"
            maxLength={100}
          />
        </form>
        <select
          className="input filter-select"
          aria-label="Сортировка"
          value={values.sort ?? 'new'}
          onChange={(e) => go({ sort: e.target.value === 'new' ? undefined : e.target.value })}
        >
          {SORTS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        {active && (
          <button
            type="button"
            className="btn ghost filter-reset"
            onClick={() => {
              setQ('');
              router.push(values.sort ? `${pathname}?sort=${values.sort}` : pathname, {
                scroll: false,
              });
            }}
          >
            Сбросить
          </button>
        )}
      </div>
    </div>
  );
}
