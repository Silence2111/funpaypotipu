import type { Metadata } from 'next';
import { ShieldCheck, AlertTriangle, Percent, Scale } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Правила и гарантии',
  description: 'Гарантии сделки, комиссии, ответственность продавца и порядок споров на GameMarket.',
};

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 24 }}>
      <h2 className="h2" style={{ fontSize: 20, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

export default function RulesPage() {
  return (
    <div className="container stack-lg" style={{ paddingTop: 48, maxWidth: 760 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>Правила и гарантии</h1>
        <p className="lead">Прозрачные условия для покупателей и продавцов — коротко и по делу.</p>
      </div>

      <div className="grid" style={{ gap: 16 }}>
        <Section icon={<ShieldCheck size={20} strokeWidth={1.75} />} title="Гарантии сделки">
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
            <li>Оплата удерживается эскроу и передаётся продавцу только после подтверждения получения.</li>
            <li>Полный возврат, если товар не получен.</li>
            <li>Возврат, если товар не соответствует описанию.</li>
            <li>Продавец обязан выдать товар в течение 24 часов — иначе заказ отменяется автоматически с возвратом.</li>
            <li>Если покупатель не подтвердит и не откроет спор, заказ подтверждается автоматически по таймеру.</li>
          </ul>
        </Section>

        <Section icon={<Percent size={20} strokeWidth={1.75} />} title="Комиссии">
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
            <li>Базовая комиссия площадки — <b>10%</b> (уже ниже, чем у большинства конкурентов).</li>
            <li>Ключи и лицензии — <b>7%</b>.</li>
            <li>Проверенным и Pro-продавцам комиссия дополнительно снижается, а холд выплат сокращается.</li>
            <li>Покупатель видит итоговую цену сразу — скрытых сборов нет.</li>
          </ul>
        </Section>

        <Section icon={<Scale size={20} strokeWidth={1.75} />} title="Споры и арбитраж">
          <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.7 }}>
            Спор рассматривает арбитр площадки на основе переписки и приложенных доказательств
            (скриншоты, файлы). Решение принимается по существу, а не автоматически в чью-либо пользу —
            обе стороны имеют равное право представить доказательства.
          </p>
        </Section>

        <Section icon={<AlertTriangle size={20} strokeWidth={1.75} />} title="Запрещено">
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
            <li>Обмен контактами и увод сделки в обход площадки (контакты в чате маскируются).</li>
            <li>Повторная продажа уже проданного аккаунта.</li>
            <li>Фиктивные сделки и накрутка отзывов.</li>
            <li>Фишинг, вредоносные вложения (все файлы проходят антивирус-проверку).</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
