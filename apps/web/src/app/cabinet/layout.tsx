import type { ReactNode } from 'react';
import { CabinetNav } from '@/components/cabinet-nav';

/**
 * Каркас кабинета: меню разделов по группам слева, страница справа. Раньше каждая
 * страница вставляла навигацию сама, двумя рядами кнопок над содержимым.
 */
export default function CabinetLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container cab-shell">
      <aside className="cab-side">
        <CabinetNav />
      </aside>
      <div className="cab-main">{children}</div>
    </div>
  );
}
