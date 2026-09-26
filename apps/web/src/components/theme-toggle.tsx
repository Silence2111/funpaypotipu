'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

/** Переключатель светлой/тёмной темы (сохраняется в localStorage). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(stored ?? (sysDark ? 'dark' : 'light'));
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    setTheme(next);
  }

  return (
    <button onClick={toggle} className="chip hide-mobile" type="button" aria-label="Переключить тему"
      style={{ padding: '6px 12px' }}>
      {theme === 'dark' ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
    </button>
  );
}
