'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ListingForm } from '@/components/listing-form';

/** «Продать в разделе» приходит сюда с ?game=…&category=… — форма открывается с ними. */
function NewListing() {
  const sp = useSearchParams();
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
