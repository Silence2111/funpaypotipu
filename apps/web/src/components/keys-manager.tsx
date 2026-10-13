'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { apiFetch, getToken, getUser } from '@/lib/session';

interface Stock {
  available: number;
  reserved: number;
  delivered: number;
  revoked: number;
}

/** Панель склада ключей — видна только владельцу авто-лота (эндпоинт вернёт 403/400 иначе). */
export function KeysManager({
  listingId,
  sellerId,
  auto,
}: {
  listingId: string;
  sellerId: string;
  auto: boolean;
}) {
  const router = useRouter();
  const [stock, setStock] = useState<Stock | null>(null);
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStock(await apiFetch<Stock>(`/listings/${listingId}/keys/stock`));
      setVisible(true);
    } catch {
      setVisible(false);
    }
  }, [listingId]);

  useEffect(() => {
    // Склад спрашиваем только у владельца авто-лота: иначе каждый покупатель
    // получал 403/400 в консоль на странице лота.
    if (auto && getToken() && getUser()?.id === sellerId) load();
  }, [load, auto, sellerId]);

  if (!visible) return null;

  async function add() {
    const keys = text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!keys.length) return;
    setMsg(null);
    try {
      const r = await apiFetch<{ added: number }>(`/listings/${listingId}/keys`, {
        method: 'POST',
        body: JSON.stringify({ keys }),
      });
      setMsg(`Добавлено ключей: ${r.added}`);
      setText('');
      await load();
      // Первые ключи возвращают закончившийся лот в продажу — страница
      // лота должна показать кнопку покупки без ручного обновления.
      router.refresh();
    } catch {
      setMsg('Не удалось добавить ключи');
    }
  }

  return (
    <section id="keys" className="card" style={{ marginTop: 40, scrollMarginTop: 80 }}>
      <h2 className="h2" style={{ fontSize: 18, marginBottom: 4 }}>
        <KeyRound size={18} /> Склад ключей
      </h2>
      <p className="faint" style={{ fontSize: 13, marginTop: 0 }}>
        Управление доступно только вам как продавцу авто-лота.
      </p>
      {stock && (
        <div className="row" style={{ gap: 16, margin: '12px 0' }}>
          <span className="badge">в наличии: {stock.available}</span>
          <span className="badge">зарезервировано: {stock.reserved}</span>
          <span className="badge">выдано: {stock.delivered}</span>
        </div>
      )}
      <textarea
        className="input"
        style={{ minHeight: 96, resize: 'vertical', fontFamily: 'monospace' }}
        placeholder={'Ключи по одному в строке:\nSTEAM-AAAA-BBBB\nSTEAM-CCCC-DDDD'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        {msg ? <span className="muted" style={{ fontSize: 14 }}>{msg}</span> : <span />}
        <button className="btn" type="button" onClick={add}>
          Загрузить
        </button>
      </div>
    </section>
  );
}
