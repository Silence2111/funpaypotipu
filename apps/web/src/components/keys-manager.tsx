'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Package } from 'lucide-react';
import { apiFetch, getToken, getUser } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

interface Stock {
  available: number;
  reserved: number;
  delivered: number;
  revoked: number;
}

const linesOf = (text: string) =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Склад автовыдачи — виден только владельцу авто-лота (эндпоинт вернёт
 * 403/400 иначе). Ключи, а у аккаунтов и предметов — логины и пароли,
 * промокоды, ссылки: по штуке в строке, покупатель получает свою сразу
 * после оплаты.
 */
export function KeysManager({
  listingId,
  sellerId,
  auto,
  keys,
}: {
  listingId: string;
  sellerId: string;
  auto: boolean;
  /** Склад ключей раздела «Ключи»; иначе — строки любого товара. */
  keys: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [stock, setStock] = useState<Stock | null>(null);
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

  const lines = linesOf(text);

  async function add() {
    if (!lines.length) return;
    setMsg(null);
    setBusy(true);
    try {
      const r = await apiFetch<{ added: number; skipped?: number }>(`/listings/${listingId}/keys`, {
        method: 'POST',
        body: JSON.stringify({ keys: lines }),
      });
      // Повторы сервер не кладёт: одна строка — одному покупателю.
      const added = t('На склад добавлено: {n}.', { n: r.added });
      setMsg({
        ok: true,
        text: r.skipped ? `${added} ${t('Повторы пропущены: {n}.', { n: r.skipped })}` : added,
      });
      setText('');
      await load();
      // Первая загрузка возвращает закончившийся лот в продажу — страница
      // лота должна показать кнопку покупки без ручного обновления.
      router.refresh();
    } catch (e) {
      setMsg({
        ok: false,
        text: apiErrorMessage(e, t('Не удалось загрузить. Попробуйте ещё раз.')),
      });
    } finally {
      setBusy(false);
    }
  }

  const Icon = keys ? KeyRound : Package;
  return (
    <section id="keys" className="card" style={{ marginTop: 40, scrollMarginTop: 80 }}>
      <h2 className="h2 row" style={{ fontSize: 18, gap: 8, marginBottom: 4 }}>
        <Icon size={18} strokeWidth={1.75} aria-hidden />{' '}
        {keys ? t('Склад ключей') : t('Склад автовыдачи')}
      </h2>
      <p className="faint" style={{ fontSize: 13, marginTop: 0 }}>
        {t(
          'Видите только вы. Каждая строка — одна штука: покупатель получает свою сразу после оплаты.',
        )}
      </p>
      {stock && (
        <div className="row" style={{ gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
          <span className="badge">{t('в наличии: {n}', { n: stock.available })}</span>
          <span className="badge">{t('зарезервировано: {n}', { n: stock.reserved })}</span>
          <span className="badge">{t('выдано: {n}', { n: stock.delivered })}</span>
        </div>
      )}
      <textarea
        className="input store-lines"
        aria-label={keys ? t('Ключи, по одному в строке') : t('Товар, по одной штуке в строке')}
        placeholder={
          keys
            ? `${t('Ключи по одному в строке:')}\nSTEAM-AAAA-BBBB\nSTEAM-CCCC-DDDD`
            : `${t('По одной штуке в строке:')}\n${t('логин:пароль')}\n${t('промокод или ссылка')}`
        }
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div
        className="row"
        style={{ justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}
      >
        {msg ? (
          <span
            className={msg.ok ? 'muted' : 'field-error'}
            role={msg.ok ? 'status' : 'alert'}
            style={{ fontSize: 14 }}
          >
            {msg.text}
          </span>
        ) : (
          <span className="hint" style={{ margin: 0 }}>
            {t('Повторы не ложатся на склад: одна строка — одному покупателю.')}
          </span>
        )}
        <button
          className="btn"
          type="button"
          disabled={busy || !lines.length}
          onClick={() => void add()}
        >
          {busy
            ? t('Загружаем…')
            : lines.length
              ? t('Загрузить {n}', { n: lines.length })
              : t('Загрузить')}
        </button>
      </div>
    </section>
  );
}
