import type { Metadata } from 'next';
import { getRankingBenchmark } from '@/lib/api';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Как мы меряем выдачу'),
    description: t(
      'Открытый замер: сравниваем порядок выдачи GameMarket с правилами «дешевле сверху» и «по числу сделок продавца» на настоящих заказах.',
    ),
  };
}

// Цифры замера меняются с каждым заказом — страницу не кэшируем.
export const dynamic = 'force-dynamic';

// Имена правил — ключи замера из shared; на экране — через t.d.
const TRIVIAL = new Set(['как_сейчас_новые_первыми', 'дешевле_сверху', 'по_сделкам_продавца']); // i18n-ignore

export default async function PodborPage() {
  const [r, t] = await Promise.all([getRankingBenchmark(), getT()]);

  return (
    <div className="container stack-lg" style={{ paddingTop: 48, maxWidth: 760 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>{t('Как мы меряем выдачу')}</h1>
        <p className="lead">
          {t(
            'Комиссию берут не за список лотов, а за то, что первый лот окажется надёжным. Порядок выдачи стоит ровно столько, на сколько бьёт правило, которое вы примените сами: «дешевле сверху» или «у кого больше сделок».',
          )}
        </p>
        <p className="muted" style={{ fontSize: 15, lineHeight: 1.7 }}>
          {t(
            'Сейчас каталог сортируется по поднятию и дате: наверху тот, кто последним нажал «поднять», потом самые свежие лоты. Надёжность продавца на место в выдаче не влияет, и мы не называем это умной выдачей.',
          )}
        </p>
      </div>

      <section className="card" style={{ padding: 24 }}>
        {!r ? (
          <p className="muted">{t('Замер сейчас недоступен: API не ответил.')}</p>
        ) : (
          <>
            <p className="faint" style={{ fontSize: 13 }}>
              {t('заказов {total} · чистых {clean} · со спором или возвратом {problem}', {
                total: r.total,
                clean: r.clean,
                problem: r.problem,
              })}
            </p>
            {r.measured ? (
              <div style={{ overflowX: 'auto', marginTop: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
                  <thead>
                    <tr className="faint" style={{ textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px 8px 0' }}>{t('Правило')}</th>
                      <th style={{ padding: '8px 12px 8px 0' }}>{t('Согласованность')}</th>
                      <th style={{ padding: '8px 0' }}>{t('Пар')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(r.results).map(([name, v]) => (
                      <tr key={name}>
                        <td style={{ padding: '8px 12px 8px 0' }}>
                          {t.d(name)}
                          {TRIVIAL.has(name) ? <span className="faint"> {t('— тривиальное')}</span> : null}
                        </td>
                        <td style={{ padding: '8px 12px 8px 0', fontVariantNumeric: 'tabular-nums' }}>
                          {v.share.toFixed(3)}
                        </td>
                        <td className="faint" style={{ padding: '8px 0' }}>{v.pairs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p style={{ marginTop: 16, fontWeight: 600, lineHeight: 1.6 }}>{t.d(r.verdict)}</p>
            {r.caveats.length ? (
              <ul className="muted" style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
                {r.caveats.map((c) => (
                  <li key={c}>{t.d(c)}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      <section className="card" style={{ padding: 24 }}>
        <h2 className="h2" style={{ fontSize: 20, marginBottom: 12 }}>{t('Что именно считается')}</h2>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
          <li>
            {t(
              'Метрика — заказ без спора и возврата. Считаем долю пар «чистый ↔ проблемный» внутри одной категории, где правило поставило чистый выше. 0.5 — монетка, 1.0 — идеал.',
            )}
          </li>
          <li>{t('Продажи и рейтинг продавца — строго на момент заказа, без взгляда в будущее.')}</li>
          <li>{t('Демонстрационные лоты в замер не входят: на придуманных данных выигрыш завышается на порядки.')}</li>
          <li>
            {t(
              'Нужно по {talk} чистых и проблемных заказов, чтобы назвать направление, и по {claim} — чтобы утверждать разницу в 10 пунктов.',
              { talk: r?.thresholds.talk ?? 25, claim: r?.thresholds.claim ?? 100 },
            )}
          </li>
        </ul>
      </section>
    </div>
  );
}
