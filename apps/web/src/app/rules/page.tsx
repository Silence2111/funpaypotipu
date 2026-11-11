import type { Metadata } from 'next';
import { ShieldCheck, AlertTriangle, Percent, Scale, Ban, MessagesSquare, Gavel } from 'lucide-react';
import { RULE_GROUPS, ruleAnchor } from '@gamemarket/shared/rules';
import { PROHIBITED_GOODS } from '@gamemarket/shared/sections';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Правила и гарантии'),
    description: t('Гарантии сделки, комиссии, ответственность продавца и порядок споров на GameMarket.'),
  };
}

function Section({ id, icon, title, children }: { id?: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card" style={{ padding: 24, scrollMarginTop: 80 }}>
      <h2 className="h2" style={{ fontSize: 20, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

export default async function RulesPage() {
  const t = await getT();
  return (
    <div className="container stack-lg" style={{ paddingTop: 48, maxWidth: 760 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>{t('Правила и гарантии')}</h1>
        <p className="lead">{t('Условия для покупателей и продавцов — коротко.')}</p>
      </div>

      <div className="grid" style={{ gap: 16 }}>
        <Section icon={<ShieldCheck size={20} strokeWidth={1.75} />} title={t('Гарантии сделки')}>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
            <li>{t('Оплата удерживается эскроу и передаётся продавцу только после подтверждения получения.')}</li>
            <li>{t('Полный возврат, если товар не получен.')}</li>
            <li>{t('Возврат, если товар не соответствует описанию.')}</li>
            <li>
              {t('Продавец обязан выдать товар в течение 24 часов — иначе заказ отменяется автоматически с возвратом.')}
            </li>
            <li>{t('Если покупатель не подтвердит и не откроет спор, заказ подтверждается автоматически по таймеру.')}</li>
          </ul>
        </Section>

        <Section icon={<Percent size={20} strokeWidth={1.75} />} title={t('Комиссии')}>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
            <li>
              {t('Базовая комиссия площадки —')} <b>10%</b>.
            </li>
            <li>
              {t('Ключи и лицензии —')} <b>7%</b>.
            </li>
            <li>{t('Проверенным и Pro-продавцам комиссия дополнительно снижается, а холд выплат сокращается.')}</li>
            <li>{t('Покупатель видит итоговую цену сразу — скрытых сборов нет.')}</li>
          </ul>
        </Section>

        <Section icon={<Scale size={20} strokeWidth={1.75} />} title={t('Споры и арбитраж')}>
          <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.7 }}>
            {t(
              'Спор рассматривает арбитр площадки на основе переписки и приложенных доказательств (скриншоты, файлы). Решение принимается по существу, а не автоматически в чью-либо пользу — обе стороны имеют равное право представить доказательства.',
            )}
          </p>
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.7 }}>
            {t(
              'Решение арбитра вступает в силу через сутки. Сторона, против которой оно вынесено, может один раз его обжаловать — спор пересмотрит другой арбитр, и его решение окончательное. Журнал выдачи (оплата, выдача, когда покупатель открыл товар) площадка прикладывает к спору сама; что приложить сторонам — подсказано на странице спора.',
            )}
          </p>
        </Section>

        {/* Список запрещённого — общий с API (часть 122): `shared/sections.ts`. */}
        <Section id="zapreshcheno" icon={<Ban size={20} strokeWidth={1.75} />} title={t('Что нельзя продавать')}>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
            {PROHIBITED_GOODS.map((g) => (
              <li key={g}>{t.d(g)}</li>
            ))}
          </ul>
          <p className="hint" style={{ margin: '12px 0 0' }}>
            {t(
              'Разделы с аккаунтами и бустом закрыты для продажи: продать аккаунт — значит передать другому человеку логин и пароль, а это закон ограничивает (ст. 13.29.2 КоАП). Лот со словами о передаче аккаунта в других разделах уходит на проверку к модератору и не появляется в каталоге, пока его не одобрят.',
            )}
          </p>
        </Section>

        <Section icon={<AlertTriangle size={20} strokeWidth={1.75} />} title={t('Запрещено')}>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
            <li>{t('Обмен контактами и увод сделки в обход площадки (контакты в чате маскируются).')}</li>
            <li>{t('Фиктивные сделки и накрутка отзывов.')}</li>
            <li>{t('Фишинг и вредоносные вложения.')}</li>
            <li>{t('Торговля между своими аккаунтами: покупка у аккаунта с тем же браузером или реквизитами вывода не пройдёт.')}</li>
          </ul>
        </Section>

        {/* Пункты с номерами (часть 134): на них ссылаются решения модераторов. */}
        <Section id="narusheniya" icon={<Gavel size={20} strokeWidth={1.75} />} title={t('Нарушения по пунктам')}>
          <div style={{ display: 'grid', gap: 12 }}>
            {RULE_GROUPS.map((g) => (
              <div key={g.title}>
                <h3 style={{ fontSize: 15, margin: '0 0 4px' }}>{t.d(g.title)}</h3>
                <ol className="muted" style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: 15, lineHeight: 1.7 }}>
                  {g.clauses.map((c) => (
                    <li key={c.id} id={ruleAnchor(c.id)} style={{ scrollMarginTop: 80, marginBottom: 6 }}>
                      <b>{c.id}</b> {t.d(c.title)}
                      {/* «Нарушение → санкция» и ответственность продавца (часть 140). */}
                      {(c.sanction || c.refund) && (
                        <span className="hint" style={{ display: 'block', margin: 0 }}>
                          {c.sanction ? t.d(c.sanction) : ''}
                          {c.refund ? ` ${t('Возврат покупателю: {pct}.', { pct: t.d(c.refund) })}` : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <p className="hint" style={{ margin: '12px 0 0' }}>
            {t('Решение модератора всегда называет пункт и причину. Не согласны — обжалуйте в кабинете, «Решения модерации»: один раз, решает другой сотрудник, ответ — в течение 48 ч. Если спорна только часть денег, удерживается только она, остальное можно выводить.')}
          </p>
        </Section>

        <Section id="chat" icon={<MessagesSquare size={20} strokeWidth={1.75} />} title={t('Чат игры')}>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
            <li>{t('Пишите, что ищете или предлагаете; сама сделка — только через лот, иначе защиты сделки нет.')}</li>
            <li>{t('Контакты и ссылки скрываются автоматически.')}</li>
            <li>{t('Нельзя: спам и повторы, сообщения заглавными, оскорбления, реклама других площадок.')}</li>
            <li>{t('Новым аккаунтам — сообщение раз в минуту и до 20 в сутки, пока нет первой сделки и не прошло 3 дня.')}</li>
            <li>{t('На сообщение можно пожаловаться. Модератор удаляет нарушения и может запретить писать в чат на сутки, неделю или месяц.')}</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
