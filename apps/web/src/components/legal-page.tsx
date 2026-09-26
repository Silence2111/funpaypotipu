import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

/**
 * Юр-страница демо-стенда. Площадка берёт деньги и персональные данные,
 * значит оферта, политика и контакты нужны. Реквизитов ещё нет — места
 * помечены «[заполнить]», а не выдуманы.
 */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="container" style={{ paddingTop: 48, maxWidth: 760 }}>
      <h1 className="h1" style={{ fontSize: 32 }}>{title}</h1>
      <div className="alert" style={{ marginTop: 20 }}>
        <Info size={18} strokeWidth={1.75} />
        <span>
          Черновик до регистрации юрлица. Места с пометкой <Fill /> — реквизиты, которых пока нет.
        </span>
      </div>
      <div className="card legal" style={{ marginTop: 20, padding: 28 }}>{children}</div>
    </div>
  );
}

export function Fill({ what }: { what?: string }) {
  return <mark className="fill">[заполнить{what ? `: ${what}` : ''}]</mark>;
}
