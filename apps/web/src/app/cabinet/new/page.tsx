'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ListingForm, type EditableListing } from '@/components/listing-form';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

/**
 * «Копировать» из «Моих лотов»: форма нового лота с условиями своего лота.
 * Заблокированный модератором лот не копируется — копия обошла бы блокировку.
 */
function CopyListing({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const [source, setSource] = useState<EditableListing | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent(`/cabinet/new?copy=${id}`)}`);
      return;
    }
    apiFetch<EditableListing>(`/listings/mine/${id}`)
      .then(setSource)
      .catch((e) => setErr(apiErrorMessage(e, t('Лот не найден или он не ваш.'))));
  }, [id, router, t]);

  if (err || source?.status === 'blocked')
    return (
      <div className="container" style={{ paddingTop: 48, maxWidth: 600 }}>
        <div className="card" style={{ padding: 24 }}>
          <p style={{ margin: '0 0 12px' }}>
            {source?.status === 'blocked' ? t('Заблокированный модератором лот скопировать нельзя.') : err}
          </p>
          <Link href="/cabinet/lots" className="btn secondary">
            {t('К моим лотам')}
          </Link>
        </div>
      </div>
    );

  if (!source)
    return (
      <div className="container" style={{ paddingTop: 48, maxWidth: 600 }} aria-busy="true" aria-label={t('Загружаем лот')}>
        <div className="skeleton" style={{ height: 34, width: 220 }} />
        <div className="skeleton" style={{ height: 420, marginTop: 24 }} />
      </div>
    );

  return <ListingForm copyOf={source} />;
}

/**
 * «Продать в разделе» приходит сюда с ?game=…&category=… — форма открывается с ними;
 * «Копировать» — с ?copy=<id лота>.
 */
function NewListing() {
  const sp = useSearchParams();
  const copy = sp.get('copy');
  if (copy) return <CopyListing key={copy} id={copy} />;
  const game = sp.get('game');
  return <ListingForm preset={game ? { game, category: sp.get('category') ?? undefined } : undefined} />;
}

export default function NewListingPage() {
  return (
    <Suspense fallback={null}>
      <NewListing />
    </Suspense>
  );
}
