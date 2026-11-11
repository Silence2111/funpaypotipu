import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/server';

/** Вход по номеру телефона (часть 121): своя вкладка, в поиске не нужна. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Вход по номеру телефона'), robots: { index: false, follow: true } };
}

export default function PhoneLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
