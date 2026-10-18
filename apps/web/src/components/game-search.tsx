'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { getGameIndex, KIND_LABELS, type GameIndexEntry } from '@/lib/api';
import { hitHref, searchGames } from '@/lib/game-search';

/**
 * Поиск по играм с подсказками. Указатель игр приходит готовым со страницы
 * (главная, «Все игры») или подгружается при первом фокусе — в шапке он
 * нужен не на каждой странице.
 *
 * Стрелки выбирают подсказку, Enter открывает её; без подсказок Enter ищет
 * по предложениям. Escape закрывает список.
 */
export function GameSearch({
  index: initial,
  size = 'md',
  autoFocus = false,
}: {
  index?: GameIndexEntry[] | null;
  size?: 'md' | 'lg';
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState<GameIndexEntry[] | null>(initial ?? null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const hits = useMemo(() => (index ? searchGames(index, q) : []), [index, q]);
  const query = q.trim();
  const options = [
    ...hits.map((h) => ({ href: hitHref(h), hit: h })),
    ...(query ? [{ href: `/catalog?q=${encodeURIComponent(query)}`, hit: null }] : []),
  ];
  const shown = open && !!query;

  useEffect(() => {
    if (!shown) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [shown]);

  function load() {
    if (!index) getGameIndex().then((list) => list && setIndex(list));
  }

  function go(href: string) {
    setOpen(false);
    setQ('');
    router.push(href);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      const n = options.length;
      if (!n) return;
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = options[active] ?? options[0];
      if (pick) go(pick.href);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const count = index?.length;
  return (
    <div className={`game-search ${size}`} ref={box}>
      <Search size={size === 'lg' ? 20 : 16} strokeWidth={1.75} aria-hidden />
      <input
        className="input"
        type="search"
        enterKeyHint="search"
        role="combobox"
        aria-label="Поиск по играм"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={count ? `Поиск по ${count} играм и сервисам` : 'Поиск по играм'}
        value={q}
        autoFocus={autoFocus}
        maxLength={60}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={onKey}
      />
      {shown && (
        <ul className="search-pop" role="listbox" id={listId} aria-label="Подсказки">
          {index && hits.length === 0 && (
            <li className="search-empty" role="presentation">
              Игры с таким названием нет — поищем среди предложений.
            </li>
          )}
          {options.map((o, i) => (
            <li
              key={o.href}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
            >
              <Link href={o.href} onClick={() => setOpen(false)} tabIndex={-1}>
                {o.hit ? (
                  <>
                    <span className="search-title">
                      {o.hit.game.title}
                      {o.hit.section && <span className="muted"> · {o.hit.section.title}</span>}
                    </span>
                    <span className="search-sub">
                      {KIND_LABELS[o.hit.game.kind]}
                      {!o.hit.section && o.hit.game.categories.length > 0 && (
                        <> · {o.hit.game.categories.map((c) => c.title).join(', ')}</>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="search-title">
                    Искать «{query}» в предложениях
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
