import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Создать аккаунт') };
}

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
