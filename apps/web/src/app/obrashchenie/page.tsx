import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';
import { ContactRequestForm } from '@/components/contact-request-form';

/** Запасная страница: на сервере /obrashchenie/ отдаёт Caddy из ~/Projects/_система/юр (проекты/lutli.txt). */
export const metadata: Metadata = { title: 'Написать оператору', robots: { index: false, follow: true } };

export default function ContactRequestPage() {
  return (
    <LegalPage title="Написать оператору" draft={false}>
      <p>
        Вопрос по данным, жалоба, претензия, отказ от договора или просьба удалить аккаунт. Ответ придёт на контакт,
        который вы укажете, в течение 10 рабочих дней.
      </p>
      <ContactRequestForm />
    </LegalPage>
  );
}
