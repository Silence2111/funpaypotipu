'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { ListingForm, type EditableListing } from '@/components/listing-form';
import { backToMyLots } from '@/lib/my-lots';
import { useT } from '@/lib/i18n/client';

/**
 * Изменение своего лота: та же форма, что при создании, с сохранёнными
 * значениями. `?back=` — с какого списка «Моих лотов» пришли: туда и вернёт.
 */
export default function EditListingPage() {
  return (
    <Suspense fallback={null}>
      <EditListing />
    </Suspense>
  );
}

function EditListing() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const back = useSearchParams().get('back');
  const [listing, setListing] = useState<EditableListing | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent(`/cabinet/lot/${id}`)}`);
      return;
    }
    apiFetch<EditableListing>(`/listings/mine/${id}`)
      .then(setListing)
      .catch((e) => setErr(apiErrorMessage(e, t('Лот не найден или он не ваш.'))));
  }, [id, router, t]);

  if (err || listing?.status === 'blocked')
    return (
      <div className="container" style={{ paddingTop: 48, maxWidth: 600 }}>
        <div className="card" style={{ padding: 24 }}>
          <p style={{ margin: '0 0 12px' }}>
            {listing?.status === 'blocked'
              ? t('Лот заблокирован модератором — изменить его нельзя. Если это ошибка, напишите в поддержку.')
              : err}
          </p>
          <Link href={backToMyLots(back)} className="btn secondary">
            {t('К моим лотам')}
          </Link>
        </div>
      </div>
    );

  if (!listing)
    return (
      <div className="container" style={{ paddingTop: 48, maxWidth: 600 }} aria-busy="true" aria-label={t('Загружаем лот')}>
        <div className="skeleton" style={{ height: 34, width: 220 }} />
        <div className="skeleton" style={{ height: 420, marginTop: 24 }} />
      </div>
    );

  return <ListingForm initial={listing} back={back} />;
}
