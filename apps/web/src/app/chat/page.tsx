import { getT } from '@/lib/i18n/server';

/** Без открытого диалога правая колонка подсказывает, что делать. */
export default async function ChatIndexPage() {
  const t = await getT();
  return (
    <div className="messenger-empty">
      {/* объёмный значок того же набора, что в шапке, вместо контурного */}
      {/* eslint-disable-next-line @next/next/no-img-element -- свой рендер */}
      <img src="/3d/chat.webp" alt="" width={72} height={72} aria-hidden />
      <p className="muted">{t('Выберите диалог слева. Написать продавцу можно со страницы любого лота.')}</p>
    </div>
  );
}
