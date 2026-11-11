'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Clock, Paperclip, ShieldAlert } from 'lucide-react';
import { apiFetch, getToken, useSession } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice, timeLeft } from '@/lib/format';
import { DISPUTE_STATUS } from '@/lib/disputes';
import { uploadViaPresignedUrl } from '@/lib/upload';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';
import { backToDisputesQueue } from '@/lib/disputes-queue';

interface Attach { url: string; mime: string }
interface DMsg {
  id: string;
  senderId: string | null;
  body: string;
  isInternal?: boolean;
  createdAt: string;
  attachments?: Attach[];
}
interface Dispute {
  id: string;
  orderId: string;
  reason: string;
  status: string;
  openedBy: string;
  arbiterId: string | null;
  resolutionNote: string | null;
  /** Чей ход и до какого времени; кто пропустил срок. */
  awaitingFrom: 'buyer' | 'seller' | null;
  respondBy: string | null;
  missedBy: 'buyer' | 'seller' | null;
  /** Решение вступает в силу (часть 135); обжалование — одно. */
  finalizeAt?: string | null;
  executedAt?: string | null;
  appealedBy?: string | null;
  appealedAt?: string | null;
  appealText?: string | null;
  firstOutcome?: 'buyer' | 'seller' | null;
  firstNote?: string | null;
}
/** Журнал выдачи — из базы площадки, не со слов сторон (часть 135). */
interface JournalEvent { at: string; code: string; count?: number }
interface Party { id: string; username: string | null }
interface DisputeView {
  dispute: Dispute;
  messages: DMsg[];
  isStaff?: boolean;
  canResolve?: boolean;
  side?: 'buyer' | 'seller' | null;
  order?: { id: string; publicNumber: string; amount: string; currency: string; title: string | null } | null;
  parties?: { buyer: Party | null; seller: Party | null; arbiter: Party | null };
  canAppeal?: boolean;
  canAccept?: boolean;
  firstArbiter?: Party | null;
  evidence?: { buyer?: string[]; seller?: string[] };
  journal?: JournalEvent[];
}

const JOURNAL: Record<string, string> = {
  paid: msg('Оплачен'),
  service_started: msg('Продавец взял заказ в работу'),
  seller_messages: msg('Продавец писал в чат заказа'),
  delivered_manual: msg('Продавец отметил выдачу'),
  delivered_auto: msg('Выдано автоматически'),
  first_view: msg('Покупатель впервые открыл товар'),
  received: msg('Покупатель отметил: данные получены'),
  confirmed: msg('Покупатель подтвердил получение'),
  service_due: msg('Срок выполнения'),
  warranty_until: msg('Гарантия до'),
};

const STATUS = DISPUTE_STATUS;

export default function DisputePage() {
  return (
    <Suspense fallback={null}>
      <Dispute />
    </Suspense>
  );
}

function Dispute() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  // Арбитр пришёл из очереди: с какой вкладкой и поиском — туда и «назад».
  const back = useSearchParams().get('back');
  const t = useT();
  const { ready, token, user: me } = useSession();
  const [view, setView] = useState<DisputeView | null>(null);
  const [draft, setDraft] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setView(await apiFetch<DisputeView>(`/disputes/${id}`));
  }, [id]);

  useEffect(() => {
    if (!getToken()) return;
    load().catch(() => setErr(t('Спор недоступен')));
  }, [load, t]);

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    void run(
      () => apiFetch(`/disputes/${id}/messages`, { method: 'POST', body: JSON.stringify({ body, internal }) }),
      t('Не удалось отправить'),
    );
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await run(async () => {
      const att = await uploadViaPresignedUrl(`/disputes/${id}/uploads`, file);
      await apiFetch(`/disputes/${id}/messages`, { method: 'POST', body: JSON.stringify({ body: '', attachments: [att] }) });
    }, t('Файл отклонён (антивирус) или хранилище недоступно'));
  }

  function resolve(outcome: 'buyer' | 'seller') {
    const decision =
      outcome === 'buyer'
        ? t('Решение: вернуть деньги покупателю. Сторона, против которой оно, сможет один раз обжаловать до вступления в силу.')
        : t('Решение: отдать деньги продавцу. Сторона, против которой оно, сможет один раз обжаловать до вступления в силу.');
    const note = window.prompt(`${decision}\n${t('Комментарий для сторон:')}`, '');
    if (note === null) return;
    void run(
      () => apiFetch(`/disputes/${id}/resolve`, { method: 'POST', body: JSON.stringify({ outcome, ...(note.trim() ? { note: note.trim() } : {}) }) }),
      t('Не удалось принять решение'),
    );
  }

  const [appealText, setAppealText] = useState('');
  const [appealing, setAppealing] = useState(false);

  function appeal(e: FormEvent) {
    e.preventDefault();
    void run(
      () => apiFetch(`/disputes/${id}/appeal`, { method: 'POST', body: JSON.stringify({ text: appealText.trim() }) }),
      t('Не удалось обжаловать решение'),
    ).then(() => setAppealing(false));
  }

  function accept() {
    if (!window.confirm(t('Принять решение арбитра? Оно исполнится сразу, обжаловать будет нельзя.'))) return;
    void run(() => apiFetch(`/disputes/${id}/accept`, { method: 'POST' }), t('Не удалось принять решение'));
  }

  function withdraw() {
    if (!window.confirm(t('Деньги уйдут продавцу, спор закроется. Отменить это будет нельзя.'))) return;
    void run(() => apiFetch(`/disputes/${id}/withdraw`, { method: 'POST' }), t('Не удалось закрыть спор'));
  }

  function refund(orderId: string) {
    if (!window.confirm(t('Деньги вернутся покупателю на баланс, спор закроется. Отменить это будет нельзя.'))) return;
    void run(
      () => apiFetch(`/orders/${orderId}/refund`, { method: 'POST', body: JSON.stringify({}) }),
      t('Не удалось вернуть деньги'),
    );
  }

  function ask(side: 'buyer' | 'seller') {
    void run(
      () => apiFetch(`/disputes/${id}/request`, { method: 'POST', body: JSON.stringify({ side }) }),
      t('Не удалось отправить запрос'),
    );
  }

  if (!ready) return <div className="container" style={{ padding: 48 }} aria-busy="true" />;
  if (!token) return <div className="container" style={{ padding: 48 }}><p className="muted">{t('Войдите, чтобы открыть спор.')}</p></div>;
  if (!view) return <div className="container" style={{ padding: 48 }}>{err ?? ''}</div>;

  const { dispute, messages, order, parties } = view;
  const open = dispute.status === 'open' || dispute.status === 'in_review';
  const sideName = (side: 'buyer' | 'seller') => (side === 'seller' ? t('продавца') : t('покупателя'));
  const deadline = dispute.respondBy
    ? new Date(dispute.respondBy).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  const left = dispute.respondBy ? timeLeft(dispute.respondBy, t) : null;
  const myTurn = !!dispute.awaitingFrom && dispute.awaitingFrom === view.side;
  const when = (iso: string) => new Date(iso).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const pending =
    (dispute.status === 'resolved_buyer' || dispute.status === 'resolved_seller') &&
    !dispute.executedAt && !!dispute.finalizeAt && new Date(dispute.finalizeAt) > new Date();
  const journal = view.journal ?? [];
  const evidence = Object.entries(view.evidence ?? {}).filter((x): x is [string, string[]] => Array.isArray(x[1]) && x[1].length > 0);
  // Подпись автора: арбитру важно видеть, кто есть кто, сторонам — где арбитр.
  const author = (m: DMsg) =>
    m.senderId === me?.id
      ? t('Вы')
      : m.senderId === parties?.buyer?.id
        ? `${t('Покупатель')}${parties?.buyer?.username ? ` · ${parties.buyer.username}` : ''}`
        : m.senderId === parties?.seller?.id
          ? `${t('Продавец')}${parties?.seller?.username ? ` · ${parties.seller.username}` : ''}`
          : t('Арбитр');

  return (
    <div className="container" style={{ paddingTop: 48, maxWidth: 720 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
        <h1 className="h2" style={{ fontSize: 22 }}>
          <ShieldAlert size={20} strokeWidth={1.75} style={{ verticalAlign: -3, marginRight: 6 }} />
          {t('Спор по заказу')}
        </h1>
        <span className={open ? 'badge warning' : 'badge'}>{STATUS[dispute.status] ? t(STATUS[dispute.status]!) : dispute.status}</span>
      </div>
      <p className="faint" style={{ fontSize: 13, margin: 0 }}>
        {back && (
          <>
            <Link href={backToDisputesQueue(back)} className="faint">← {t('Очередь споров')}</Link>
            {' · '}
          </>
        )}
        <Link href={`/orders/${dispute.orderId}`} className="faint">{back ? t('К заказу') : `← ${t('К заказу')}`}</Link>
      </p>

      <div className="card" style={{ marginTop: 16, padding: 16 }}>
        {order && (
          <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{order.title ?? order.publicNumber}</span>
            <span className="price" style={{ fontSize: 16 }}>{formatPrice(order.amount, order.currency, t)}</span>
          </div>
        )}
        {parties && (
          <p className="faint" style={{ margin: '0 0 10px', fontSize: 13 }}>
            {t('Покупатель {buyer} · продавец {seller}', {
              buyer: parties.buyer?.username ?? '—',
              seller: parties.seller?.username ?? '—',
            })}
            {parties.arbiter ? ` · ${t('арбитр {name}', { name: parties.arbiter.username ?? '' })}` : ''}
          </p>
        )}
        <div className="faint" style={{ fontSize: 12, marginBottom: 4 }}>{t('Причина спора')}</div>
        <p className="muted" style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{dispute.reason}</p>
        {!open && dispute.resolutionNote && (
          <p style={{ margin: '12px 0 0', fontSize: 14 }}>
            <span className="faint">{t('Комментарий арбитра:')} </span>{dispute.resolutionNote}
          </p>
        )}
      </div>

      {/* Решение ждёт вступления в силу (часть 135): обжаловать один раз или принять сразу. */}
      {pending && (
        <div className="card" style={{ marginTop: 12, padding: 16, display: 'grid', gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <Clock size={16} strokeWidth={1.75} aria-hidden />
            <b style={{ fontSize: 15 }}>
              {dispute.status === 'resolved_buyer' ? t('Решение — в пользу покупателя.') : t('Решение — в пользу продавца.')}{' '}
              {t('Вступит в силу {date}.', { date: when(dispute.finalizeAt!) })}
            </b>
          </div>
          {view.canAppeal && !appealing && (
            <p className="hint" style={{ margin: 0 }}>
              {t('Не согласны — обжалуйте один раз: спор пересмотрит другой арбитр, его решение окончательное. Согласны — примите, и решение исполнится сразу.')}
            </p>
          )}
          {appealing ? (
            <form onSubmit={appeal} style={{ display: 'grid', gap: 8 }}>
              <label className="label" htmlFor="dispute-appeal">{t('Почему решение неверно')}</label>
              <textarea id="dispute-appeal" className="input" rows={4} maxLength={2000} value={appealText}
                onChange={(e) => setAppealText(e.target.value)} style={{ resize: 'vertical' }} />
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" type="submit" disabled={busy || appealText.trim().length < 10}>{t('Обжаловать')}</button>
                <button className="btn ghost" type="button" onClick={() => setAppealing(false)}>{t('Отмена')}</button>
              </div>
            </form>
          ) : (
            (view.canAppeal || view.canAccept) && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {view.canAppeal && (
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => setAppealing(true)}>{t('Обжаловать')}</button>
                )}
                {view.canAccept && (
                  <button type="button" className="chip" disabled={busy} onClick={accept}>{t('Принять решение')}</button>
                )}
              </div>
            )
          )}
        </div>
      )}

      {dispute.appealedAt && (
        <div className="card flat" style={{ marginTop: 12, padding: 16, background: 'var(--page)', display: 'grid', gap: 6, fontSize: 14 }}>
          <b>{t('Решение обжаловано')}</b>
          {dispute.appealText && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>«{dispute.appealText}»</p>}
          {dispute.firstOutcome && (
            <span className="faint">
              {dispute.firstOutcome === 'buyer' ? t('Первое решение — в пользу покупателя') : t('Первое решение — в пользу продавца')}
              {view.firstArbiter?.username ? ` · ${t('арбитр {name}', { name: view.firstArbiter.username })}` : ''}
              {dispute.firstNote ? ` · «${dispute.firstNote}»` : ''}
            </span>
          )}
          {open && <span className="hint">{t('Пересматривает другой арбитр — его решение окончательное.')}</span>}
        </div>
      )}

      {journal.length > 0 && (
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <div className="label" style={{ marginBottom: 6 }}>{t('Журнал выдачи')}</div>
          <p className="hint" style={{ margin: '0 0 8px' }}>{t('Из системы площадки — не со слов сторон.')}</p>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 4, fontSize: 14 }}>
            {journal.map((e, i) => (
              <li key={i} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="faint" style={{ minWidth: 130 }}>{when(e.at)}</span>
                <span>
                  {JOURNAL[e.code] ? t(JOURNAL[e.code]!) : e.code}
                  {e.code === 'first_view' && e.count ? ` · ${t('открывал {n}', { n: t.n(e.count, 'раз', 'раза', 'раз') })}` : ''}
                  {e.code === 'seller_messages' && e.count ? ` · ${t.n(e.count, 'сообщение', 'сообщения', 'сообщений')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && evidence.length > 0 && (
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          {evidence.map(([who, items]) => (
            <div key={who}>
              <div className="label" style={{ marginBottom: 6 }}>
                {view.side ? t('Что приложить') : who === 'buyer' ? t('Что приложить покупателю') : t('Что приложить продавцу')}
              </div>
              <ul className="muted" style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
                {items.map((x) => <li key={x}>{t.d(x)}</li>)}
              </ul>
            </div>
          ))}
          <p className="hint" style={{ margin: 0 }}>{t('Файлы — скрепкой под перепиской. Чем точнее доказательства, тем быстрее решение.')}</p>
        </div>
      )}

      {open && dispute.awaitingFrom && deadline && (
        <div className={myTurn ? 'alert warning' : 'alert'} role="status" style={{ marginTop: 12 }}>
          <Clock size={16} strokeWidth={1.75} aria-hidden />
          <span>
            {myTurn
              ? t('Ваш ход: ответьте до {date}. Без ответа арбитр решит по тому, что есть.', { date: deadline })
              : t('Ждём ответа {side} до {date}.', { side: sideName(dispute.awaitingFrom), date: deadline })}
            {left && ` ${t('Осталось {left}.', { left })}`}
          </span>
        </div>
      )}
      {open && dispute.missedBy && !dispute.respondBy && (
        <div className="alert" role="status" style={{ marginTop: 12 }}>
          <Clock size={16} strokeWidth={1.75} aria-hidden />
          <span>
            {dispute.missedBy === 'seller'
              ? t('Продавец не ответил в срок — арбитр учтёт это при решении.')
              : t('Покупатель не ответил в срок — арбитр учтёт это при решении.')}
          </span>
        </div>
      )}

      {open && view.side && order && (
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <div className="label" style={{ marginBottom: 6 }}>{t('Договорились сами?')}</div>
          <p className="hint" style={{ margin: '0 0 10px' }}>
            {view.side === 'buyer'
              ? t('Если товар в порядке, закройте спор — деньги уйдут продавцу, арбитр не понадобится.')
              : t('Если покупатель прав, верните деньги — спор закроется без арбитра.')}
          </p>
          {view.side === 'buyer' ? (
            <button type="button" className="chip" disabled={busy} onClick={withdraw}>
              {t('Претензий нет — завершить сделку')}
            </button>
          ) : (
            <button type="button" className="chip" disabled={busy} onClick={() => refund(order.id)}>
              {t('Вернуть деньги покупателю')}
            </button>
          )}
        </div>
      )}

      {view.canResolve && open && (
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <div className="label" style={{ marginBottom: 8 }}>{t('Решение арбитра')}</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {dispute.status === 'open' && (
              <button type="button" className="btn secondary" disabled={busy}
                onClick={() => void run(() => apiFetch(`/disputes/${id}/take`, { method: 'POST' }), t('Не удалось взять спор'))}>
                {t('Взять в работу')}
              </button>
            )}
            <button type="button" className="chip" disabled={busy} onClick={() => resolve('buyer')}>
              {t('Вернуть деньги покупателю')}
            </button>
            <button type="button" className="chip" disabled={busy} onClick={() => resolve('seller')}>
              {t('Отдать деньги продавцу')}
            </button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>{t('Деньги сразу уходят выбранной стороне, стороны получат уведомление.')}</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <span className="hint" style={{ alignSelf: 'center' }}>{t('Запросить пояснения:')}</span>
            <button type="button" className="chip" disabled={busy} onClick={() => ask('buyer')}>
              {t('у покупателя')}
            </button>
            <button type="button" className="chip" disabled={busy} onClick={() => ask('seller')}>
              {t('у продавца')}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '20px 0 16px' }}>
        {messages.map((m) => m.senderId === null ? (
          <div key={m.id} className="sys-msg">{t.d(m.body)}</div>
        ) : (
          <div key={m.id} style={{ alignSelf: m.senderId === me?.id ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
            <div className="faint" style={{ fontSize: 12, margin: '0 4px 2px' }}>
              {author(m)}
              {m.isInternal ? ` · ${t('заметка, стороны её не видят')}` : ''}
            </div>
            <div className={`bubble ${m.senderId === me?.id ? 'mine' : 'their'}`}
              style={m.isInternal ? { background: 'var(--warning-bg)', color: 'var(--fg)' } : undefined}>
              {m.attachments?.length
                ? m.attachments.map((a, i) =>
                    a.mime.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={a.url} alt={t('доказательство')} style={{ maxWidth: 220, borderRadius: 8, display: 'block' }} />
                    ) : (
                      <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                        {t('Файл-доказательство')}
                      </a>
                    ),
                  )
                : m.body}
            </div>
          </div>
        ))}
        {!messages.length && <p className="muted" style={{ fontSize: 14 }}>{t('Сообщений пока нет. Опишите ситуацию и приложите доказательства.')}</p>}
      </div>

      {err && <p className="field-error" role="alert">{err}</p>}

      {open && (
        <form onSubmit={send}>
          <div className="row" style={{ gap: 8 }}>
            <label className="chip" style={{ cursor: 'pointer' }} aria-label={t('Прикрепить доказательство')}>
              <Paperclip size={16} strokeWidth={1.75} />
              <input type="file" onChange={onFile} disabled={busy} style={{ display: 'none' }} />
            </label>
            <input className="input" aria-label={t('Сообщение')} enterKeyHint="send" value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder={view.isStaff ? t('Сообщение сторонам…') : t('Сообщение арбитру и второй стороне…')} />
            <button className="btn" type="submit" disabled={busy}>{t('Отправить')}</button>
          </div>
          {view.isStaff && (
            <label className="row hint" style={{ gap: 8, marginTop: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
              {t('Заметка для сотрудников — стороны её не увидят')}
            </label>
          )}
        </form>
      )}
    </div>
  );
}
