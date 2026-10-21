'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { presenceText } from '@/lib/presence';
import { offersCount } from '@/lib/format';
import { Avatar } from '@/components/offers';
import { CabinetNav } from '@/components/cabinet-nav';
import { useT } from '@/lib/i18n/client';

interface Followed {
  sellerId: string;
  username: string;
  avatarUrl: string | null;
  online: boolean;
  onlineAt: string | null;
  away: boolean;
  activeListings: number;
  onSale: number;
  notify: boolean;
}

/**
 * «Подписки»: продавцы, на которых подписан человек, — в сети ли, сколько
 * лотов и сколько со скидкой, уведомления по каждому. Подписываются в
 * профиле продавца или в его карточке на странице лота.
 */
export default function FollowingPage() {
  const t = useT();
  const router = useRouter();
  const [list, setList] = useState<Followed[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/following');
      return;
    }
    apiFetch<Followed[]>('/follows')
      .then(setList)
      .catch(() => setMsg({ ok: false, text: t('Не удалось загрузить подписки.') }));
  }, [router, t]);

  async function toggle(f: Followed) {
    setBusy(f.sellerId);
    setMsg(null);
    try {
      await apiFetch(`/follows/${f.sellerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ notify: !f.notify }),
      });
      setList(
        (l) => l?.map((x) => (x.sellerId === f.sellerId ? { ...x, notify: !f.notify } : x)) ?? null,
      );
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, t('Не удалось сохранить.')) });
    } finally {
      setBusy(null);
    }
  }

  async function unfollow(f: Followed) {
    setBusy(f.sellerId);
    setMsg(null);
    try {
      await apiFetch(`/follows/${f.sellerId}`, { method: 'DELETE' });
      setList((l) => l?.filter((x) => x.sellerId !== f.sellerId) ?? null);
      setMsg({ ok: true, text: t('Вы отписались от {name}.', { name: f.username }) });
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, t('Не получилось. Попробуйте ещё раз.')) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Подписки')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t(
            'Продавцы, на которых вы подписаны. Их новые лоты и скидки приходят уведомлением — на сайте, в Telegram и пушем, как настроено в группе «Поиски, избранное и подписки».',
          )}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {msg && (
        <div
          className={msg.ok ? 'alert success' : 'alert error'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </div>
      )}

      {list === null ? (
        !msg && <div className="skeleton" style={{ height: 240 }} aria-busy="true" />
      ) : list.length === 0 ? (
        <div className="card flat empty-state">
          <p className="muted" style={{ maxWidth: '60ch' }}>
            {t(
              'Подписок пока нет. Нажмите «Подписаться» в профиле продавца или в его карточке на странице лота — его новые лоты и скидки придут уведомлением.',
            )}
          </p>
          <Link href="/igry" className="btn secondary">
            {t('Все игры')}
          </Link>
        </div>
      ) : (
        <ul className="searches">
          {list.map((f) => (
            <li key={f.sellerId} className="card searches-item">
              <div className="following-main">
                <Avatar name={f.username} url={f.avatarUrl} online={f.online} size={44} t={t} />
                <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
                  <Link href={`/prodavec/${f.sellerId}`} className="searches-title">
                    {f.username}
                  </Link>
                  <div className="hint">
                    {f.away
                      ? t('в отпуске')
                      : (presenceText(f.onlineAt, Date.now(), t) ?? t('не в сети'))}
                    {' · '}
                    {f.activeListings ? offersCount(f.activeListings, t) : t('нет предложений')}
                    {f.onSale > 0 && <> · {t('со скидкой: {n}', { n: f.onSale })}</>}
                  </div>
                </div>
              </div>
              <div className="searches-actions">
                <button
                  type="button"
                  role="switch"
                  className="switch"
                  aria-checked={f.notify}
                  aria-label={t('Уведомлять о новых лотах и скидках {name}', { name: f.username })}
                  disabled={busy === f.sellerId}
                  onClick={() => void toggle(f)}
                >
                  <span className="switch-track" aria-hidden>
                    <span className="switch-thumb" />
                  </span>
                  <span className="switch-label" aria-hidden>
                    {f.notify ? t('Уведомления включены') : t('Без уведомлений')}
                  </span>
                </button>
                <div className="row" style={{ gap: 6 }}>
                  <Link href={`/prodavec/${f.sellerId}`} className="chip">
                    {t('Предложения')}
                  </Link>
                  <button
                    type="button"
                    className="chip"
                    disabled={busy === f.sellerId}
                    onClick={() => void unfollow(f)}
                  >
                    {t('Отписаться')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
