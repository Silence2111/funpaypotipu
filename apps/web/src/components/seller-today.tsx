'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, MessageCircle, Package, PackageX, Percent } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';

interface Today {
  day: string;
  seller: boolean;
  sales: { count: number; earned: string };
  yesterday: { count: number; earned: string };
  views: number;
  waiting: {
    toDeliver: number;
    awaitingBuyer: number;
    disputes: number;
    unreadMessages: number;
    soldOut: number;
    salesEnding: number;
  };
}

/**
 * «Сегодня» вверху кабинета продавца: продажи и заработанное за день по
 * Москве против вчера, просмотры лотов — и что ждёт его самого, ссылками
 * прямо туда. Ничего не ждёт — так и написано. У покупателя без лотов и
 * продаж блока нет.
 */
export function SellerToday() {
  const t = useT();
  const [d, setD] = useState<Today | null>(null);

  useEffect(() => {
    apiFetch<Today>('/sellers/me/today')
      .then(setD)
      .catch(() => {});
  }, []);

  if (!d?.seller) return null;
  const w = d.waiting;
  const items = [
    {
      n: w.toDeliver,
      href: '/cabinet/orders?role=seller&f=work',
      icon: Package,
      label: t('Выдать товар'),
    },
    {
      n: w.disputes,
      href: '/cabinet/orders?role=seller&f=dispute',
      icon: AlertTriangle,
      label: t('Споры'),
    },
    {
      n: w.unreadMessages,
      href: '/chat',
      icon: MessageCircle,
      label: t('Непрочитанные сообщения'),
    },
    {
      n: w.awaitingBuyer,
      href: '/cabinet/orders?role=seller&f=work',
      icon: Clock,
      label: t('Ждут подтверждения покупателя'),
    },
    {
      n: w.soldOut,
      href: '/cabinet/lots?f=sold_out',
      icon: PackageX,
      label: t('Лоты закончились'),
    },
    {
      n: w.salesEnding,
      href: '/cabinet/lots',
      icon: Percent,
      label: t('Скидки кончаются сегодня'),
    },
  ].filter((i) => i.n > 0);
  const date = new Date(`${d.day}T12:00:00Z`).toLocaleDateString(t.locale, {
    day: 'numeric',
    month: 'long',
  });

  return (
    <section className="card seller-today" aria-labelledby="today-title">
      <div className="section-head" style={{ margin: 0 }}>
        <h2 className="h2" id="today-title" style={{ fontSize: 20, margin: 0 }}>
          {t('Сегодня')}
        </h2>
        <span className="faint" style={{ fontSize: 14 }}>
          {date}
        </span>
      </div>
      <dl className="today-kpis">
        <div>
          <dt>{t('Продажи')}</dt>
          <dd className="num">{t.num(d.sales.count)}</dd>
          <dd className="faint">{t('вчера {n}', { n: t.num(d.yesterday.count) })}</dd>
        </div>
        <div>
          <dt>{t('Заработано')}</dt>
          <dd className="num">{formatPrice(d.sales.earned, 'RUB', t)}</dd>
          <dd className="faint">
            {t('вчера {n}', { n: formatPrice(d.yesterday.earned, 'RUB', t) })}
          </dd>
        </div>
        <div>
          <dt>{t('Просмотры лотов')}</dt>
          <dd className="num">{t.num(d.views)}</dd>
        </div>
      </dl>
      {items.length ? (
        <ul className="today-waiting" aria-label={t('Что ждёт вас')}>
          {items.map((i) => (
            <li key={i.label}>
              <Link href={i.href}>
                <i.icon size={16} strokeWidth={1.75} aria-hidden />
                <span>{i.label}</span>
                <b className="num">{t.num(i.n)}</b>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          {t('Ничего не ждёт: заказы выданы, споров и новых сообщений нет.')}
        </p>
      )}
    </section>
  );
}
