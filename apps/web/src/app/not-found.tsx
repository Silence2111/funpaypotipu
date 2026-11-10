import Link from 'next/link';
import { Gamepad2 } from 'lucide-react';
import { getT } from '@/lib/i18n/server';

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="container" style={{ paddingTop: 96, paddingBottom: 96, textAlign: 'center' }}>
      <Gamepad2 size={48} strokeWidth={1.75} className="faint" style={{ marginBottom: 12 }} aria-hidden />
      <h1 className="h1" style={{ fontSize: 34, marginBottom: 8 }}>{t('Страница не найдена')}</h1>
      <p className="lead" style={{ margin: '0 auto 28px', maxWidth: 440 }}>
        {t('Похоже, этот лот уже купили, а страницу — телепортировали. Но в каталоге ещё много всего.')}
      </p>
      <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
        <Link href="/catalog" className="btn">{t('В каталог')}</Link>
        <Link href="/" className="chip">{t('На главную')}</Link>
      </div>
    </div>
  );
}
