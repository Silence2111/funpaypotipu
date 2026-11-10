'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { UserCheck, UserPlus } from 'lucide-react';
import { apiFetch, useSession } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';

interface FollowState {
  following: boolean;
  notify: boolean;
  followers: number;
}

/** «12 подписчиков», «1 подписчик», «3 подписчика». */
export const followersCount = (n: number, t: T): string =>
  t.n(n, 'подписчик', 'подписчика', 'подписчиков');

/**
 * «Подписаться» на продавца: его новые лоты и скидки придут уведомлением.
 * В профиле — с числом подписчиков (своему продавцу — только число), в
 * карточке продавца на лоте — одна кнопка. Гостя ведёт на вход и обратно.
 */
export function FollowButton({
  sellerId,
  followers,
  compact = false,
}: {
  sellerId: string;
  /** Подписчиков на момент загрузки страницы. */
  followers: number;
  compact?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const { ready, user } = useSession();
  const [state, setState] = useState<FollowState>({ following: false, notify: false, followers });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const own = user?.id === sellerId;

  useEffect(() => {
    if (!user || user.id === sellerId) return;
    apiFetch<FollowState>(`/follows/${sellerId}`)
      .then(setState)
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [user, sellerId]);

  if (!ready || (own && compact)) return null;

  const count = !compact && state.followers > 0 && (
    <span className="faint follow-count">{followersCount(state.followers, t)}</span>
  );
  if (own) return count || null;

  async function toggle() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(path)}`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      setState(
        await apiFetch<FollowState>(`/follows/${sellerId}`, {
          method: state.following ? 'DELETE' : 'POST',
        }),
      );
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не получилось. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="chip"
        aria-pressed={state.following}
        disabled={busy || (!!user && !loaded)}
        title={
          state.following
            ? t('Новые лоты и скидки продавца приходят уведомлением. Нажмите, чтобы отписаться.')
            : t('Новые лоты и скидки продавца будут приходить уведомлением')
        }
        onClick={() => void toggle()}
      >
        {state.following ? (
          <UserCheck size={15} strokeWidth={1.75} aria-hidden />
        ) : (
          <UserPlus size={15} strokeWidth={1.75} aria-hidden />
        )}{' '}
        {state.following ? t('Вы подписаны') : t('Подписаться')}
      </button>
      {count}
      {err && (
        <p className="field-error" role="alert" style={{ flexBasis: '100%', margin: 0 }}>
          {err}
        </p>
      )}
    </>
  );
}
