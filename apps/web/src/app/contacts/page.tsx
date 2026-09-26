import type { Metadata } from 'next';
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
      <p>Проблема с заказом — быстрее всего открыть спор на странице заказа: арбитр видит переписку и статус оплаты.</p>
    </LegalPage>
  );
}
