'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { getGames, type Game } from '@/lib/api';

export function SearchBar({ initial = '', game }: { initial?: string; game?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [games, setGames] = useState<Game[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getGames().then((g) => setGames(g ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const term = q.trim().toLowerCase();
  const matches = term ? games.filter((g) => g.title.toLowerCase().includes(term)).slice(0, 6) : [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (game) params.set('game', game);
    router.push(`/catalog${params.toString() ? `?${params}` : ''}`);
    setOpen(false);
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <form onSubmit={submit} className="row" style={{ gap: 8 }}>
        <input className="input" placeholder="Поиск лотов и игр…" value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} />
        <button className="btn" type="submit" aria-label="Искать">
          <Search size={16} strokeWidth={1.75} />
        </button>
      </form>

      {open && matches.length > 0 && (
        <div className="notif-dropdown" style={{ top: 46, left: 0, width: '100%', maxWidth: 420 }}>
          {matches.map((g) => (
            <button key={g.id} type="button" className="notif-item"
              onClick={() => { router.push(`/catalog?game=${g.slug}`); setOpen(false); }}>
              {g.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
