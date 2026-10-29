'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';
import { CardWidget, type CardToken } from './card-widget';

interface Method {
  key: string;
  label: string;
  feePct: number;
  minFee: string;
  minAmount: string;
  maxAmount: string;
  /** Выплачивает шлюз сам после одобрения (ЮKassa: СБП, ЮMoney, карта). */
  auto?: boolean;
  /** Карта — через виджет ЮKassa: id шлюза и скрипт. */
  widget?: { accountId: string; scriptUrl: string } | null;
}

/** Сохранённые реквизиты: маска и банк — сами реквизиты на сайт не приходят. */
interface Saved {
  id: string;
  method: string;
  hint: string | null;
  bank: string | null;
}

/** Куда выводить — подсказка поля по способу. */
const PLACEHOLDER: Record<string, string> = {
  sbp: msg('Телефон, +7 900 000-00-00'),
  card: msg('Номер карты'),
  yoomoney: msg('Номер кошелька ЮMoney'),
  usdt: msg('Адрес кошелька USDT (TRC20)'),
};

/**
 * Заявка на вывод средств: выбор способа + живое превью «на руки». Список
 * заявок — рядом, в «Кошельке»: `onDone` обновляет и баланс, и его.
 * Реквизиты можно запомнить: в следующий раз — выбрать, а не вводить; форма
 * открывается на тех, что выбирали последними.
 */
export function PayoutForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [methods, setMethods] = useState<Method[]>([]);
  const [methodKey, setMethodKey] = useState('');
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  // Банк для СБП через ЮKassa — из её списка.
  const [banks, setBanks] = useState<Array<{ id: string; name: string }>>([]);
  const [bankId, setBankId] = useState('');
  // Карта из виджета ЮKassa: токен и маска, номер у нас не бывает.
  const [card, setCard] = useState<CardToken | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  // Выбранные сохранённые реквизиты; пусто — вводятся новые.
  const [choice, setChoice] = useState('');
  const [remember, setRemember] = useState(true);
  const opened = useRef(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Крупный вывод — после проверки личности: порог площадки и свой статус.
  const [kycAbove, setKycAbove] = useState<number | null>(null);
  const [verified, setVerified] = useState(true);

  useEffect(() => {
    apiFetch<Method[]>('/payouts/methods')
      .then((m) => { setMethods(m ?? []); setMethodKey(m?.[0]?.key ?? ''); })
      .catch(() => {});
    apiFetch<{ payoutKycAboveMinor?: string }>('/fees/public')
      .then((p) => setKycAbove(p.payoutKycAboveMinor ? Number(p.payoutKycAboveMinor) : null))
      .catch(() => {});
    apiFetch<{ status: string }>('/kyc/me')
      .then((k) => setVerified(k.status === 'approved'))
      .catch(() => {});
    apiFetch<Saved[]>('/payouts/destinations')
      .then((list) => setSaved(list ?? []))
      .catch(() => {});
  }, []);

  function loadSaved() {
    return apiFetch<Saved[]>('/payouts/destinations')
      .then((list) => { setSaved(list ?? []); return list ?? []; })
      .catch(() => [] as Saved[]);
  }

  // Открыть форму на последних выбранных реквизитах — один раз, дальше решает человек.
  useEffect(() => {
    if (opened.current || !methods.length) return;
    const last = saved[0];
    if (!last) return;
    opened.current = true;
    if (methods.some((m) => m.key === last.method)) {
      setMethodKey(last.method);
      setChoice(last.id);
    }
  }, [methods, saved]);

  function pickMethod(key: string) {
    setMethodKey(key);
    setChoice(saved.find((s) => s.method === key)?.id ?? '');
    setMsg(null);
  }

  async function forget(id: string) {
    try {
      await apiFetch(`/payouts/destinations/${id}`, { method: 'DELETE' });
      const rest = saved.filter((s) => s.id !== id);
      setSaved(rest);
      if (choice === id) setChoice(rest.find((s) => s.method === methodKey)?.id ?? '');
    } catch (e) {
      setMsg(apiErrorMessage(e, t('Не удалось удалить реквизиты')));
    }
  }

  const method = methods.find((m) => m.key === methodKey);
  const mine = saved.filter((s) => s.method === methodKey);
  const fresh = !choice;
  const sbpAuto = method?.key === 'sbp' && !!method.auto;
  const cardWidget = method?.key === 'card' && method.auto ? method.widget ?? null : null;
  useEffect(() => {
    if (!sbpAuto || banks.length) return;
    apiFetch<Array<{ id: string; name: string }>>('/payouts/sbp-banks')
      .then((b) => setBanks(b ?? []))
      .catch(() => {});
  }, [sbpAuto, banks.length]);
  const rub = parseFloat(amount.replace(',', '.'));
  const grossMinor = rub > 0 ? Math.round(rub * 100) : 0;
  const fee = method && grossMinor > 0
    ? Math.max(Math.floor(grossMinor * method.feePct), Number(method.minFee))
    : 0;
  const net = Math.max(0, grossMinor - fee);
  const belowMin = method && grossMinor > 0 && grossMinor < Number(method.minAmount);
  const needsKyc = !verified && kycAbove != null && grossMinor > kycAbove;

  async function go() {
    if (!method) return;
    if (!(rub > 0) || (fresh && (cardWidget ? !card : dest.trim().length < 4))) {
      setMsg(cardWidget && rub > 0 ? t('Укажите карту в форме ЮKassa') : t('Укажите сумму и реквизиты'));
      return;
    }
    if (fresh && sbpAuto && !bankId) { setMsg(t('Выберите банк для перевода по СБП')); return; }
    if (belowMin) {
      setMsg(t('Минимум для «{method}» — {sum}', { method: t.d(method.label), sum: formatPrice(method.minAmount, 'RUB', t) }));
      return;
    }
    setBusy(true); setMsg(null);
    try {
      await apiFetch('/payouts', {
        method: 'POST',
        body: JSON.stringify({
          amount: String(grossMinor),
          method: method.key,
          ...(!fresh
            ? { savedId: choice }
            : { ...(cardWidget ? { card } : { destination: dest.trim() }), ...(sbpAuto ? { bankId } : {}), save: remember }),
        }),
      });
      setMsg(t('Заявка на вывод создана')); setAmount(''); setDest(''); setCard(null); onDone();
      // Только что запомненные — сразу выбраны.
      void loadSaved().then((list) => setChoice(list.find((s) => s.method === method.key)?.id ?? ''));
    } catch (e) {
      setMsg(apiErrorMessage(e, t('Не удалось создать заявку')));
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select className="input" aria-label={t('Способ вывода')} value={methodKey} onChange={(e) => pickMethod(e.target.value)}
          style={{ maxWidth: 220 }}>
          {methods.map((m) => (
            <option key={m.key} value={m.key}>
              {t.d(m.label)} · {(m.feePct * 100).toLocaleString(t.locale, { maximumFractionDigits: 1 })}%
            </option>
          ))}
        </select>
        <input className="input" aria-label={t('Сумма вывода, ₽')} placeholder={t('Сумма, ₽')} inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 130 }} />
      </div>

      {mine.length > 0 && (
        <div className="payout-saved" role="radiogroup" aria-label={t('Сохранённые реквизиты')}>
          {mine.map((s) => (
            <div key={s.id} className="payout-saved-item">
              <label className="row" style={{ gap: 8 }}>
                <input type="radio" name="payout-saved" checked={choice === s.id} onChange={() => setChoice(s.id)} />
                <span className="payout-saved-hint">{s.hint ?? t.d(method?.label ?? '')}</span>
                {s.bank && <span className="faint">{s.bank}</span>}
              </label>
              <button type="button" className="link-button faint" onClick={() => void forget(s.id)}
                aria-label={t('Удалить реквизиты {hint}', { hint: s.hint ?? '' })}>
                {t('Удалить')}
              </button>
            </div>
          ))}
          <div className="payout-saved-item">
            <label className="row" style={{ gap: 8 }}>
              <input type="radio" name="payout-saved" checked={fresh} onChange={() => setChoice('')} />
              <span>{t('Другие реквизиты')}</span>
            </label>
          </div>
        </div>
      )}

      {fresh && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {sbpAuto && (
            <select className="input" aria-label={t('Банк для СБП')} value={bankId} onChange={(e) => setBankId(e.target.value)}
              style={{ maxWidth: 200 }}>
              <option value="">{t('Банк получателя')}</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          {cardWidget ? (
            <div className="card-slot">
              <CardWidget accountId={cardWidget.accountId} scriptUrl={cardWidget.scriptUrl} card={card}
                onCard={(c) => { setCard(c); setMsg(null); }} />
            </div>
          ) : (
            <input className="input" aria-label={t('Куда вывести')}
              placeholder={PLACEHOLDER[methodKey] ? t(PLACEHOLDER[methodKey]!) : t('Номер карты или телефон СБП')} value={dest}
              inputMode={methodKey === 'sbp' ? 'tel' : methodKey === 'card' ? 'numeric' : 'text'} autoComplete="off"
              autoCapitalize="none" spellCheck={false}
              onChange={(e) => setDest(e.target.value)} style={{ maxWidth: 260 }} />
          )}
        </div>
      )}
      {fresh && (
        <label className="row" style={{ gap: 8, fontSize: 14, marginTop: 8 }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('Запомнить реквизиты для следующих выводов')}
        </label>
      )}
      <div style={{ marginTop: 12 }}>
        <button className="btn secondary" onClick={go} disabled={busy} type="button">{t('Вывести')}</button>
      </div>

      {method && grossMinor > 0 && !belowMin && (
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, marginTop: 8, maxWidth: 300 }}>
          <span className="faint">{t('Комиссия {sum}', { sum: formatPrice(String(fee), 'RUB', t) })}</span>
          <span style={{ fontWeight: 600, color: 'var(--success)' }}>
            {t('на руки {sum}', { sum: formatPrice(String(net), 'RUB', t) })}
          </span>
        </div>
      )}
      {needsKyc && (
        <p className="hint" style={{ marginTop: 8 }}>
          {t('Больше {sum} за раз — после проверки личности.', { sum: formatPrice(String(kycAbove), 'RUB', t) })}{' '}
          <Link href="/cabinet/verification" className="inline-link">{t('Пройти проверку')}</Link>
        </p>
      )}
      {method?.auto && (
        <p className="hint" style={{ marginTop: 8 }}>
          {t('Деньги придут автоматически через ЮKassa после проверки заявки.')}
        </p>
      )}
      {msg && <p className="faint" style={{ fontSize: 13, marginTop: 8 }}>{msg}</p>}
    </div>
  );
}
