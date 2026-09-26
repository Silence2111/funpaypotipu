import type { Metadata } from 'next';
import { getRankingBenchmark } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Как мы меряем выдачу',
  description:
    'Открытый замер: сравниваем порядок выдачи GameMarket с правилами «дешевле сверху» и «по числу сделок продавца» на настоящих заказах.',
};

// Цифры замера меняются с каждым заказом — страницу не кэшируем.
export const dynamic = 'force-dynamic';

const TRIVIAL = new Set(['как_сейчас_новые_первыми', 'дешевле_сверху', 'по_сделкам_продавца']);

export default async function PodborPage() {
  const r = await getRankingBenchmark();

  return (
    <div className="container stack-lg" style={{ paddingTop: 48, maxWidth: 760 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>Как мы меряем выдачу</h1>
        <p className="lead">
          Комиссию берут не за список лотов, а за то, что первый лот окажется надёжным. Порядок
          выдачи стоит ровно столько, на сколько бьёт правило, которое вы примените сами:
          «дешевле сверху» или «у кого больше сделок».
        </p>
        <p className="muted" style={{ fontSize: 15, lineHeight: 1.7 }}>
          Сейчас каталог сортируется по поднятию и дате: наверху тот, кто последним нажал
          «поднять», потом самые свежие лоты. Надёжность продавца на место в выдаче не влияет,
          и мы не называем это умной выдачей.
        </p>
      </div>

      <section className="card" style={{ padding: 24 }}>
        {!r ? (
          <p className="muted">Замер сейчас недоступен: API не ответил.</p>
        ) : (
          <>
            <p className="faint" style={{ fontSize: 13 }}>
              заказов {r.total} · чистых {r.clean} · со спором или возвратом {r.problem}
            </p>
            {r.measured ? (
              <div style={{ overflowX: 'auto', marginTop: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
                  <thead>
                    <tr className="faint" style={{ textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px 8px 0' }}>Правило</th>
                      <th style={{ padding: '8px 12px 8px 0' }}>Согласованность</th>
                      <th style={{ padding: '8px 0' }}>Пар</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(r.results).map(([name, v]) => (
                      <tr key={name}>
                        <td style={{ padding: '8px 12px 8px 0' }}>
                          {name}
                          {TRIVIAL.has(name) ? <span className="faint"> — тривиальное</span> : null}
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
            <p style={{ marginTop: 16, fontWeight: 600, lineHeight: 1.6 }}>{r.verdict}</p>
            {r.caveats.length ? (
              <ul className="muted" style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
                {r.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      <section className="card" style={{ padding: 24 }}>
        <h2 className="h2" style={{ fontSize: 20, marginBottom: 12 }}>Что именно считается</h2>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
          <li>
            Метрика — заказ без спора и возврата. Считаем долю пар «чистый ↔ проблемный» внутри
            одной категории, где правило поставило чистый выше. 0.5 — монетка, 1.0 — идеал.
          </li>
          <li>Продажи и рейтинг продавца — строго на момент заказа, без взгляда в будущее.</li>
          <li>Демонстрационные лоты в замер не входят: на придуманных данных выигрыш завышается на порядки.</li>
          <li>
            Нужно по {r?.thresholds.talk ?? 25} чистых и проблемных заказов, чтобы назвать
            направление, и по {r?.thresholds.claim ?? 100} — чтобы утверждать разницу в 10 пунктов.
          </li>
        </ul>
      </section>
    </div>
  );
}
