import type { ReactNode } from 'react';
import { Info, Languages } from 'lucide-react';
import { getT } from '@/lib/i18n/server';

/**
 * Юр-страница демо-стенда. Площадка берёт деньги и персональные данные,
 * значит оферта, политика и контакты нужны. Реквизитов ещё нет — места
 * помечены «[заполнить]», а не выдуманы.
 */
export async function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const t = await getT();
  return (
    <div className="container" style={{ paddingTop: 48, maxWidth: 760 }}>
      {/* Перевод документа не имеет силы — на английском честно говорим, что он по-русски. */}
      {t.lang === 'en' && (
        <div className="alert" style={{ marginBottom: 20 }} lang="en">
          <Languages size={18} strokeWidth={1.75} />
          <span>{t('Этот документ — только на русском. Действует русская версия.')}</span>
        </div>
      )}
      <h1 className="h1" style={{ fontSize: 32 }} lang="ru">{title}</h1>
      <div className="alert" style={{ marginTop: 20 }}>
        <Info size={18} strokeWidth={1.75} />
        {t.lang === 'en' ? (
          <span>
            {t('Черновик до регистрации юрлица. Места с пометкой «[заполнить]» — реквизиты, которых пока нет.')}
          </span>
        ) : (
          <span>
            Черновик до регистрации юрлица. Места с пометкой <Fill /> — реквизиты, которых пока нет.
          </span>
        )}
      </div>
      <div className="card legal" style={{ marginTop: 20, padding: 28 }} lang="ru">{children}</div>
    </div>
  );
}

export function Fill({ what }: { what?: string }) {
  return <mark className="fill">[заполнить{what ? `: ${what}` : ''}]</mark>;
}
