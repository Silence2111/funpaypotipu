'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { BottomSheet } from './bottom-sheet';
import { IosInstallSteps } from './ios-install-steps';

/** Событие установки Chrome и Edge: в стандартных типах DOM его нет. */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * «Установить приложение» — там, где браузер умеет ставить сайт (Chrome,
 * Edge, Android) и он ещё не установлен. На iPhone в Safari кнопки
 * установки нет — показываем инструкцию «Поделиться → На экран „Домой“»
 * (часть 139): только так iPhone даёт сайту пуши.
 */
export function InstallApp() {
  const t = useT();
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [steps, setSteps] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setPrompt(null);
    const nav = navigator as Navigator & { standalone?: boolean };
    const iphone = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installed = window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
    setIos(iphone && !installed);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!prompt && ios) {
    return (
      <>
        <button type="button" className="chip" onClick={() => setSteps(true)}>
          <Download size={16} strokeWidth={1.75} aria-hidden /> {t('Установить приложение')}
        </button>
        {steps && (
          <BottomSheet label={t('Установить на iPhone')} onClose={() => setSteps(false)}>
            <div style={{ padding: '4px 8px 12px', display: 'grid', gap: 14 }}>
              <b style={{ fontSize: 17 }}>{t('Установить на iPhone')}</b>
              <IosInstallSteps />
            </div>
          </BottomSheet>
        )}
      </>
    );
  }
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
