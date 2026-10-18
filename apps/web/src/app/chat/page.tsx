import { MessagesSquare } from 'lucide-react';

/** Без открытого диалога правая колонка подсказывает, что делать. */
export default function ChatIndexPage() {
  return (
    <div className="messenger-empty">
      <MessagesSquare size={32} strokeWidth={1.75} aria-hidden />
      <p className="muted">Выберите диалог слева. Написать продавцу можно со страницы любого лота.</p>
    </div>
  );
}
