'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellRing } from 'lucide-react';
import { apiFetch, getToken, getUser } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

/**
 * «Сообщить о поступлении» у закончившегося лота: когда продавец пополнит
 * наличие, придёт одно уведомление — на сайте, в Telegram и пушем. Гость
 * уходит на вход, продавцу своего лота кнопка не нужна.
 */
export function StockWatchButton({ listingId, sellerId }: { listingId: string; sellerId: string }) {
  const t = useT();
  const router = useRouter();
  const [watching, setWatching] = useState(false);
  const [mine, setMine] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMine(getUser()?.id === sellerId);
    if (!getToken()) return;
    apiFetch<{ watching: boolean }>(`/stock-watches/${listingId}`)
      .then((r) => setWatching(r.watching))
      .catch(() => {});
  }, [listingId, sellerId]);

  if (mine) return null;

  async function toggle() {
    if (!getToken()) {
      router.push(`/login?next=${encodeURIComponent(`/lot/${listingId}`)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ watching: boolean }>(`/stock-watches/${listingId}`, {
        method: watching ? 'DELETE' : 'POST',
      });
      setWatching(r.watching);
    } catch (e) {
      setError(apiErrorMessage(e, t('Не получилось. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stock-watch">
      <button
        type="button"
        className={watching ? 'btn secondary' : 'btn'}
        aria-pressed={watching}
        disabled={busy}
        onClick={() => void toggle()}
      >
        {watching ? (
          <BellRing size={18} strokeWidth={1.75} aria-hidden />
        ) : (
          <Bell size={18} strokeWidth={1.75} aria-hidden />
        )}
        {watching ? t('Сообщим о поступлении') : t('Сообщить о поступлении')}
      </button>
      <p className="hint" role={error ? 'alert' : undefined}>
        {error ??
          (watching
            ? t(
                'Пришлём уведомление, когда лот снова появится в продаже. Нажмите ещё раз, чтобы не ждать.',
              )
            : t(
                'Продавец может пополнить наличие — пришлём одно уведомление, когда лот снова появится.',
              ))}
      </p>
    </div>
  );
}
