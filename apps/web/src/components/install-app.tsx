'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

/** Событие установки Chrome и Edge: в стандартных типах DOM его нет. */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * «Установить приложение» — только там, где браузер умеет ставить сайт
 * (Chrome, Edge, Android) и он ещё не установлен. На iPhone кнопки нет:
 * Safari ставит сайт через «Поделиться → На экран „Домой“».
 */
export function InstallApp() {
  const t = useT();
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!prompt) return null;
  return (
    <button
      type="button"
      className="chip"
      onClick={async () => {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') setPrompt(null);
      }}
    >
      <Download size={16} strokeWidth={1.75} aria-hidden /> {t('Установить приложение')}
    </button>
  );
}
