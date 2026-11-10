import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminConsole } from '@/components/admin/admin-console';

export const metadata: Metadata = { title: 'Консоль', robots: { index: false } };

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminConsole />
    </Suspense>
  );
}
