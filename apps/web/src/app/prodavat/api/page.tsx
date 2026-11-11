import type { Metadata } from 'next';
import Link from 'next/link';
import { API_RATE_PER_MIN, API_STOCK_MAX, WEBHOOK_RETRY_MINUTES } from '@gamemarket/shared/seller-api';
import { getT } from '@/lib/i18n/server';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('API для продавцов'),
    description: t('Лоты, наличие, склад автовыдачи, заказы и вебхук «новый заказ» — по ключу, без пароля от аккаунта.'),
    alternates: { canonical: `${SITE}/prodavat/api` },
  };
}

function Endpoint({ method, path, children }: { method: string; path: string; children: React.ReactNode }) {
  return (
    <div className="card flat" style={{ padding: 16, display: 'grid', gap: 6 }}>
      <code style={{ fontWeight: 600 }}>
        {method} {path}
      </code>
      <div className="muted" style={{ fontSize: 15 }}>{children}</div>
    </div>
  );
}

const pre = { background: 'var(--bg-subtle)', padding: 12, borderRadius: 12, overflowX: 'auto', fontSize: 13, margin: 0 } as const;

/**
 * Документация API для продавцов (часть 127). То, ради чего на FunPay
 * ставят сторонних ботов с паролем от аккаунта, — по ключу из
 * «Инструментов», который можно отозвать.
 */
export default async function SellerApiDocs() {
  const t = await getT();
  return (
    <div className="container stack-lg" style={{ paddingTop: 48, maxWidth: 760 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>{t('API для продавцов')}</h1>
        <p className="lead">
          {t('Свой бот или склад: цены и наличие, загрузка товара для автовыдачи, заказы и отметка выдачи — по ключу, без пароля от аккаунта.')}
        </p>
      </div>

      <section className="stack-form" style={{ gap: 10 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>{t('Ключ')}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('Выпустите ключ в')} <Link href="/cabinet/tools" style={{ color: 'var(--accent)' }}>{t('«Инструментах»')}</Link>{' '}
          {t('и передавайте его в заголовке. Ключ показывается один раз; утёк — отзовите, он перестанет работать сразу. До 5 ключей.')}
        </p>
        <pre style={pre}>{`curl ${API}/api/v1/me \\
  -H "Authorization: Bearer gm_live_…"`}</pre>
        <p className="hint" style={{ margin: 0 }}>
          {t('Не больше {n} запросов в минуту на ключ, сверх — ответ 429 и заголовок Retry-After. Каждый запрос — в журнале «Инструментов» 30 дней.', { n: API_RATE_PER_MIN })}
        </p>
      </section>

      <section className="stack-form" style={{ gap: 10 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>{t('Лоты')}</h2>
        <Endpoint method="GET" path="/api/v1/listings?status=active&limit=50&cursor=…">
          {t('Свои лоты: цена (копейки строкой), наличие, статус, игра и раздел. Дальше — по next.')}
        </Endpoint>
        <Endpoint method="PATCH" path="/api/v1/listings/{id}">
          {t('Поменять цену, наличие или снять и вернуть: {"price": "49000", "stock": 3, "status": "paused"}. Правила те же, что на сайте.')}
        </Endpoint>
        <Endpoint method="POST" path="/api/v1/listings/{id}/stock">
          {t('Склад автовыдачи: {"items": ["ключ или строка товара", …]}, до {n} за раз. Повторы и уже выданное пропускаются.', { n: API_STOCK_MAX })}
        </Endpoint>
      </section>

      <section className="stack-form" style={{ gap: 10 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>{t('Заказы')}</h2>
        <Endpoint method="GET" path="/api/v1/orders?status=paid&since=2026-11-01T00:00:00Z">
          {t('Свои продажи: номер, статус, сумма и сколько придёт вам, ник покупателя и его ответы на поля лота.')}
        </Endpoint>
        <Endpoint method="POST" path="/api/v1/orders/{id}/deliver">
          {t('Отметить выдачу. С {"message": "…"} — сообщение покупателю в чат заказа (контакты скрываются, как в чате).')}
        </Endpoint>
      </section>

      <section className="stack-form" style={{ gap: 10 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>{t('Вебхук «оплачен новый заказ»')}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('Задайте адрес (https) в «Инструментах» — получите секрет. На каждый оплаченный заказ придёт POST с JSON и заголовками:')}
        </p>
        <pre style={pre}>{`X-GM-Event: order.paid
X-GM-Delivery: <delivery-id>
X-GM-Signature: sha256=<hmac_sha256(body, secret)>

{"event":"order.paid","createdAt":"…","data":{"id":"…","publicNumber":"GM-…",
 "listingId":"…","title":"…","qty":1,"amount":"49000","sellerPayout":"44100",
 "currency":"RUB","buyerData":[{"label":"Nick","value":"…"}],"autoDelivery":false}}`}</pre>
        <p className="hint" style={{ margin: 0 }}>
          {t('Проверяйте подпись: HMAC-SHA256 тела вашим секретом. Ответ не 2xx или тишина 5 секунд — повторим через {delays} мин.', {
            delays: WEBHOOK_RETRY_MINUTES.join(', '),
          })}
        </p>
      </section>
    </div>
  );
}
