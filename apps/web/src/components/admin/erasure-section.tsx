'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { downloadFile } from '@/lib/download';
import { Empty, when } from './shared';

interface Act {
  id: string;
  number: number;
  day: string;
  reason: string;
  reasonText: string;
  subjects: number;
  records: number;
  categories: string[];
  signedAt: string | null;
  signedBy: string | null;
}

/**
 * Уничтожение персональных данных (часть 147, приказ РКН № 179): акты по
 * дням и причинам — скачать акт для печати и подписи, выгрузку из журнала,
 * отметить «подписан». Акты хранятся 3 года, потом удаляются сами.
 */
export function ErasureSection() {
  const [rows, setRows] = useState<Act[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await apiFetch<Act[]>('/admin/erasure/acts'));
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(apiErrorMessage(e, 'Не удалось загрузить акты.')));
  }, [load]);

  async function run(id: string, fn: () => Promise<unknown>, fallback: string) {
    setBusy(id);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(apiErrorMessage(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Каждое уничтожение персональных данных — в журнале; записи одного дня и одной причины — в одном акте. Акт
        распечатать и подписать ответственному, в консоли отметить «Подписан». Акты и выгрузки хранятся 3 года.
      </p>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        <Empty>Уничтожений пока не было.</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((a) => (
            <div key={a.id} className="card" style={{ padding: 16, display: 'grid', gap: 8 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', fontSize: 14 }}>
                <b>Акт № {a.number}</b>
                <span className="faint">{a.day.split('-').reverse().join('.')}</span>
                <span>субъектов: {a.subjects}, записей: {a.records}</span>
                {a.signedAt ? (
                  <span className="badge success">подписан · {a.signedBy ?? 'сотрудник'} · {when(a.signedAt)}</span>
                ) : (
                  <span className="badge warning">не подписан</span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 14 }}>{a.reasonText}</p>
              <p className="hint" style={{ margin: 0 }}>{a.categories.join('; ')}</p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="chip" disabled={busy === a.id}
                  onClick={() => void run(a.id, () => downloadFile(`/admin/erasure/acts/${a.id}/act`), 'Не удалось скачать акт.')}>
                  Скачать акт
                </button>
                <button type="button" className="chip" disabled={busy === a.id}
                  onClick={() => void run(a.id, () => downloadFile(`/admin/erasure/acts/${a.id}/journal.csv`), 'Не удалось скачать выгрузку.')}>
                  Выгрузка из журнала
                </button>
                {!a.signedAt && (
                  <button type="button" className="btn" disabled={busy === a.id}
                    onClick={() => {
                      if (!window.confirm(`Акт № ${a.number} распечатан и подписан ответственным?`)) return;
                      void run(a.id, async () => {
                        await apiFetch(`/admin/erasure/acts/${a.id}/sign`, { method: 'POST' });
                        await load();
                      }, 'Не удалось отметить подпись.');
                    }}>
                    Подписан
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
