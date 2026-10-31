import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, Fill } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Контакты' };

export default function ContactsPage() {
  return (
    <LegalPage title="Контакты">
      <dl>
        <dt>Поддержка</dt>
        <dd><Fill what="почта" /></dd>
        <dt>Телеграм</dt>
        <dd><Fill /></dd>
        <dt>Юрлицо и реквизиты</dt>
        <dd><Fill what="наименование, ИНН, ОГРН, адрес" /></dd>
      </dl>
      <p>
        Вопрос к площадке — <Link href="/cabinet/support">обращение в поддержку</Link> из кабинета: ответ придёт
        на сайт, на почту, в Telegram и пушем на телефон, если они включены.
      </p>
      <p>Проблема с заказом — быстрее всего открыть спор на странице заказа: арбитр видит переписку и статус оплаты.</p>
    </LegalPage>
  );
}
