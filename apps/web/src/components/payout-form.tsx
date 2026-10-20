'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

interface Method {
  key: string;
  label: string;
  feePct: number;
  minFee: string;
  minAmount: string;
  maxAmount: string;
  /** Выплачивает шлюз сам после одобрения (ЮKassa: СБП и ЮMoney). */
  auto?: boolean;
}

interface MyPayout {
  id: string;
  amount: string;
  currency: string;
  method: string;
  status: string;
  createdAt: string;
}

/** Куда выводить — подсказка поля по способу. */
const PLACEHOLDER: Record<string, string> = {
  sbp: msg('Телефон, +7 900 000-00-00'),
  card: msg('Номер карты'),
  yoomoney: msg('Номер кошелька ЮMoney'),
  usdt: msg('Адрес кошелька USDT (TRC20)'),
};

/** Статус заявки для продавца: «отправляется» — шлюз ещё не подтвердил. */
const STATUS: Record<string, string> = {
  requested: msg('на проверке'),
  approved: msg('отправляется'),
  processing: msg('отправляется'),
  paid: msg('выплачено'),
  rejected: msg('отклонена, деньги на балансе'),
};

/** Заявка на вывод средств: выбор способа + живое превью «на руки». */
export function PayoutForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [methods, setMethods] = useState<Method[]>([]);
  const [methodKey, setMethodKey] = useState('');
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  // Банк для СБП через ЮKassa — из её списка.
  const [banks, setBanks] = useState<Array<{ id: string; name: string }>>([]);
  const [bankId, setBankId] = useState('');
  const [mine, setMine] = useState<MyPayout[]>([]);
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
    apiFetch<MyPayout[]>('/payouts/mine')
      .then((rows) => setMine(rows ?? []))
      .catch(() => {});
  }, []);

  const method = methods.find((m) => m.key === methodKey);
  const sbpAuto = method?.key === 'sbp' && !!method.auto;
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
    if (!(rub > 0) || dest.trim().length < 4) { setMsg(t('Укажите сумму и реквизиты')); return; }
    if (sbpAuto && !bankId) { setMsg(t('Выберите банк для перевода по СБП')); return; }
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
          destination: dest.trim(),
          ...(sbpAuto ? { bankId } : {}),
        }),
      });
      setMsg(t('Заявка на вывод создана')); setAmount(''); setDest(''); onDone();
      apiFetch<MyPayout[]>('/payouts/mine').then((rows) => setMine(rows ?? [])).catch(() => {});
    } catch (e) {
      setMsg(apiErrorMessage(e, t('Не удалось создать заявку')));
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select className="input" aria-label={t('Способ вывода')} value={methodKey} onChange={(e) => setMethodKey(e.target.value)}
          style={{ maxWidth: 170 }}>
          {methods.map((m) => (
            <option key={m.key} value={m.key}>
              {t.d(m.label)} · {(m.feePct * 100).toLocaleString(t.locale, { maximumFractionDigits: 1 })}%
            </option>
          ))}
        </select>
        <input className="input" aria-label={t('Сумма вывода, ₽')} placeholder={t('Сумма, ₽')} inputMode="decimal" value={amount}
          onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 130 }} />
        {sbpAuto && (
          <select className="input" aria-label={t('Банк для СБП')} value={bankId} onChange={(e) => setBankId(e.target.value)}
            style={{ maxWidth: 200 }}>
            <option value="">{t('Банк получателя')}</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        <input className="input" aria-label={t('Куда вывести')}
          placeholder={PLACEHOLDER[methodKey] ? t(PLACEHOLDER[methodKey]!) : t('Номер карты или телефон СБП')} value={dest}
          inputMode={methodKey === 'sbp' ? 'tel' : methodKey === 'card' ? 'numeric' : 'text'} autoComplete="off"
          autoCapitalize="none" spellCheck={false}
          onChange={(e) => setDest(e.target.value)} style={{ maxWidth: 180 }} />
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
      {mine.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="faint" style={{ fontSize: 13, marginBottom: 4 }}>{t('Заявки на вывод')}</div>
          {mine.slice(0, 5).map((p) => (
            <div key={p.id} className="row" style={{ justifyContent: 'space-between', gap: 12, fontSize: 14, padding: '4px 0', maxWidth: 420 }}>
              <span>
                {formatPrice(p.amount, p.currency, t)}{' '}
                <span className="faint">· {new Date(p.createdAt).toLocaleDateString(t.locale)}</span>
              </span>
              <span
                className={p.status === 'rejected' ? 'faint' : undefined}
                style={p.status === 'paid' ? { color: 'var(--success)' } : undefined}
              >
                {STATUS[p.status] ? t(STATUS[p.status]!) : p.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
