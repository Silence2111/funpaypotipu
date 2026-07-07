'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

export function SearchBar({ initial = '', game }: { initial?: string; game?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (game) params.set('game', game);
    router.push(`/catalog${params.toString() ? `?${params}` : ''}`);
  }

  return (
    <form onSubmit={submit} className="row" style={{ gap: 8 }}>
      <input
        className="input"
        placeholder="Поиск лотов…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <button className="btn" type="submit" aria-label="Искать">
        <Search size={16} strokeWidth={1.75} />
      </button>
    </form>
  );
}
