'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { CabinetNav } from '@/components/cabinet-nav';
import { NotificationSettings } from '@/components/notification-settings';
import { useT } from '@/lib/i18n/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Profile {
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  email: string | null;
  emailVerified: boolean;
}
interface Block { userId: string; username: string | null; createdAt: string }

/**
 * Профиль: имя, «о себе», аватар — то, что видят покупатели на витрине.
 * Здесь же чёрный список. Ник не меняется: по нему находят продавца и отзывы.
 */
export default function SettingsPage() {
  const t = useT();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const p = await apiFetch<Profile>('/account/profile');
    setProfile(p);
    setDisplayName(p.displayName);
    setBio(p.bio ?? '');
    setBlocks(await apiFetch<Block[]>('/account/blocks').catch(() => []));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/settings');
      return;
    }
    load().catch(() => setMsg({ ok: false, text: t('Не удалось загрузить профиль') }));
  }, [router, load, t]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const p = await apiFetch<Profile>('/account/profile', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: displayName.trim(), bio: bio.trim() || null }),
      });
      setProfile(p);
      setBio(p.bio ?? '');
      setMsg({ ok: true, text: t('Профиль сохранён. Контакты в «О себе» скрываются, как в чате.') });
    } catch (err) {
      setMsg({ ok: false, text: apiErrorMessage(err, t('Не удалось сохранить профиль.')) });
    } finally {
      setBusy(false);
    }
  }

  async function onAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMsg(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_URL}/api/account/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Accept-Language': t.lang },
      body: fd,
    }).catch(() => null);
    if (!res?.ok) {
      const text = (await res?.text().catch(() => '')) ?? '';
      setMsg({ ok: false, text: apiErrorMessage(new Error(text), t('Аватар не загрузился.')) });
      return;
    }
    const { avatarUrl } = (await res.json()) as { avatarUrl: string };
    setProfile((p) => (p ? { ...p, avatarUrl } : p));
  }

  async function unblock(b: Block) {
    try {
      await apiFetch(`/account/blocks/${b.userId}`, { method: 'DELETE' });
      setBlocks((list) => (list ?? []).filter((x) => x.userId !== b.userId));
    } catch (err) {
      setMsg({ ok: false, text: apiErrorMessage(err, t('Не удалось убрать из чёрного списка.')) });
    }
  }

  const initial = (profile?.displayName || profile?.username || '?').charAt(0).toUpperCase();

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>{t('Профиль')}</h1>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {msg && (
        <div className={msg.ok ? 'alert success' : 'alert error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </div>
      )}

      {!profile ? (
        <div className="skeleton" style={{ height: 240 }} aria-busy="true" />
      ) : (
        <form onSubmit={save} className="card stack-form" style={{ padding: 24, gap: 18, maxWidth: 600 }}>
          <div className="row" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div
              aria-hidden
              style={{
                width: 72, height: 72, borderRadius: 999, overflow: 'hidden', flex: 'none',
                background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 28, fontWeight: 600, color: 'var(--fg-muted)',
              }}
            >
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                initial
              )}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="chip" style={{ cursor: 'pointer' }}>
                {profile.avatarUrl ? t('Сменить аватар') : t('Загрузить аватар')}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onAvatar} style={{ display: 'none' }} />
              </label>
              {profile.avatarUrl && (
                <button type="button" className="chip"
                  onClick={() => void apiFetch('/account/avatar', { method: 'DELETE' }).then(() => setProfile({ ...profile, avatarUrl: null }))}>
                  {t('Убрать')}
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <span className="label">{t('Ник')}</span>
            <p style={{ margin: 0 }}>
              @{profile.username} <span className="hint">{t('— не меняется: по нему находят ваши лоты и отзывы')}</span>
            </p>
          </div>

          <div className="field">
            <label className="label" htmlFor="display-name">{t('Имя на витрине')}</label>
            <input id="display-name" className="input" maxLength={40} value={displayName}
              onChange={(e) => setDisplayName(e.target.value)} />
          </div>

          <div className="field">
            <label className="label" htmlFor="bio">{t('О себе — необязательно')}</label>
            <textarea id="bio" className="input" rows={4} maxLength={500} value={bio} style={{ resize: 'vertical' }}
              placeholder={t('Что продаёте, как быстро отвечаете, в какое время на связи')}
              onChange={(e) => setBio(e.target.value)} />
            <p className="hint">{t('{n} / 500. Видно покупателям на странице продавца.', { n: bio.length })}</p>
          </div>

          <div className="field">
            <span className="label">{t('Почта')}</span>
            <p style={{ margin: 0 }}>
              {profile.email ?? t('не указана')}{' '}
              <span className="hint">{profile.emailVerified ? t('— подтверждена') : t('— не подтверждена')}</span>
            </p>
          </div>

          <div>
            <button className="btn" type="submit" disabled={busy}>{busy ? t('Сохраняем…') : t('Сохранить')}</button>
          </div>
        </form>
      )}

      <NotificationSettings />

      <section style={{ maxWidth: 600 }}>
        <h2 className="h2" style={{ fontSize: 18, marginBottom: 6 }}>{t('Чёрный список')}</h2>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 14 }}>
          {t('Кто здесь, тот не напишет вам до сделки и не купит ваши лоты. Добавить — кнопкой на странице продавца.')}
        </p>
        {blocks === null ? (
          <div className="skeleton" style={{ height: 60 }} aria-busy="true" />
        ) : blocks.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>{t('Список пуст.')}</p>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {blocks.map((b) => (
              <div key={b.userId} className="card row" style={{ padding: 14, justifyContent: 'space-between', gap: 12 }}>
                <span>
                  <Link href={`/prodavec/${b.userId}`} style={{ fontWeight: 600 }}>{b.username ?? t('пользователь')}</Link>
                  <span className="faint" style={{ fontSize: 13 }}>
                    {' · '}
                    {t('с {date}', { date: new Date(b.createdAt).toLocaleDateString(t.locale) })}
                  </span>
                </span>
                <button type="button" className="chip" onClick={() => void unblock(b)}>{t('Убрать')}</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
