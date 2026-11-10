'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Copy } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { formatPrice, mskDate } from '@/lib/format';
import { CabinetNav } from '@/components/cabinet-nav';
import { useT } from '@/lib/i18n/client';

type Me = {
  active: boolean;
  shareBps: number;
  termDays: number;
  code: string | null;
  stats?: {
    clicks: number;
    clicks30: number;
    registrations: number;
    deals: number;
    accrued: string;
  };
  recent?: Array<{
    at: string;
    role: 'buyer' | 'seller';
    amount: string;
    currency: string;
    order: string;
  }>;
};

/**
 * Кабинет партнёра (часть 116): ссылка и код, переходы, регистрации,
 * сделки и начислено. Вознаграждение — на баланс, вывод — из кошелька.
 * Пока площадка не включила программу — так и написано, без обещаний.
 */
export default function PartnerPage() {
  const t = useT();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/partner');
      return;
    }
    apiFetch<Me>('/partners/me')
      .then(setMe)
      .catch(() => setErr(true));
  }, [router]);

  const link = me?.code ? `${location.origin}/?ref=${me.code}` : '';
  async function copy(what: 'link' | 'code') {
    await navigator.clipboard?.writeText(what === 'link' ? link : (me?.code ?? ''));
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Партнёрам')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '62ch' }}>
          {t(
            'Приводите покупателей и продавцов на GameMarket — получайте долю с их сделок на баланс.',
          )}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {err ? (
        <div className="alert error" role="alert">
          {t('Не удалось загрузить партнёрскую программу.')}
        </div>
      ) : me === null ? (
        <div className="skeleton" style={{ height: 240 }} aria-busy="true" />
      ) : !me.active && !me.code ? (
        <div className="card flat empty-state">
          <p className="muted" style={{ maxWidth: '60ch' }}>
            {t(
              'Партнёрская программа пока не работает. Когда площадка её включит, здесь появятся ваша ссылка и код.',
            )}
          </p>
        </div>
      ) : (
        // Свой отступ между блоками: у подсказки margin 0 перебил бы отступ страницы.
        <div style={{ display: 'grid', gap: 16 }}>
          {!me.active && (
            <div className="alert" role="status">
              {t(
                'Программа сейчас выключена: новые переходы и сделки не считаются. Начисленное остаётся на балансе.',
              )}
            </div>
          )}
          {me.active && (
            <div className="card" style={{ padding: 20, display: 'grid', gap: 14 }}>
              <p style={{ margin: 0 }}>
                {t(
                  'С каждой завершённой сделки приглашённого — покупки или продажи — вам {share}% того, что площадка на ней заработала. Считаются сделки за {days} дней после его регистрации.',
                  { share: me.shareBps / 100, days: me.termDays },
                )}
              </p>
              <div className="field">
                <span className="label">{t('Ваша ссылка')}</span>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input
                    className="input input-mono"
                    readOnly
                    value={link}
                    style={{ flex: '1 1 260px' }}
                    aria-label={t('Ваша ссылка')}
                  />
                  <button type="button" className="btn secondary" onClick={() => void copy('link')}>
                    {copied === 'link' ? (
                      <Check size={16} aria-hidden />
                    ) : (
                      <Copy size={16} aria-hidden />
                    )}
                    {copied === 'link' ? t('Скопировано') : t('Копировать')}
                  </button>
                </div>
              </div>
              <div className="field">
                <span className="label">{t('Код партнёра — для поля при регистрации')}</span>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="request-budget" style={{ fontSize: 20 }}>
                    {me.code}
                  </span>
                  <button type="button" className="chip" onClick={() => void copy('code')}>
                    {copied === 'code' ? t('Скопировано') : t('Копировать')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {me.stats && (
            <div className="partner-stats">
              {[
                [t('Переходы за 30 дней'), String(me.stats.clicks30)],
                [t('Регистрации'), String(me.stats.registrations)],
                [t('Сделки'), String(me.stats.deals)],
                [t('Начислено'), formatPrice(me.stats.accrued, 'RUB', t)],
              ].map(([label, value]) => (
                <div key={label} className="card flat partner-stat">
                  <span className="faint" style={{ fontSize: 13 }}>
                    {label}
                  </span>
                  <span className="partner-stat-value">{value}</span>
                </div>
              ))}
            </div>
          )}

          {me.recent && me.recent.length > 0 && (
            <div>
              <h2 className="h2" style={{ fontSize: 20, marginBottom: 10 }}>
                {t('Начисления')}
              </h2>
              <ul className="requests">
                {me.recent.map((a) => (
                  <li
                    key={a.order}
                    className="card flat request-item"
                    style={{ padding: '12px 16px' }}
                  >
                    <div className="request-head">
                      <span>
                        {mskDate(a.at, t)} ·{' '}
                        {a.role === 'seller'
                          ? t('продажа приглашённого')
                          : t('покупка приглашённого')}{' '}
                        · <span className="faint">{a.order}</span>
                      </span>
                      <span className="request-budget">
                        +{formatPrice(a.amount, a.currency, t)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="hint" style={{ maxWidth: '64ch' }}>
            {t(
              'Начисления — на баланс, вывести их можно из кошелька, как деньги за продажи. Не считаются: сделки с вами самим, спорные сделки и аккаунты, созданные с того же устройства или адреса, что и ваш.',
            )}{' '}
            <Link href="/cabinet/wallet" style={{ color: 'var(--accent)' }}>
              {t('Кошелёк')}
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
