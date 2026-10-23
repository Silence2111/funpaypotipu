'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { CabinetNav } from '@/components/cabinet-nav';
import { SellerPromos } from '@/components/seller-promos';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';
import { COMMAND_MAX } from '@gamemarket/shared';

interface Template {
  id: string;
  title: string;
  body: string;
  command: string | null;
}
interface Tools {
  greeting: string | null;
  autoRaise: boolean;
  raise: { everyHours: number; activeLots: number; nextInMinutes: number | null };
  templates: Template[];
}

const GREETING_MAX = 1000;

/** Метка ника собеседника в заготовке; чат понимает обе. */
const nameToken = (t: T) => (t.lang === 'en' ? '{name}' : '{имя}'); // i18n-ignore

/** «2 ч 15 мин», «40 мин». */
function wait(min: number, t: T) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return t('{m} мин', { m });
  return m ? t('{h} ч {m} мин', { h, m }) : t('{h} ч', { h });
}

/**
 * Инструменты продавца — то, ради чего продавцы FunPay ставят бота, но
 * встроенное: автоподнятие лотов, приветствие покупателю в новом диалоге
 * и заготовки ответов для чата — с командой заготовка становится
 * автоответом.
 */
export default function ToolsPage() {
  const t = useT();
  const router = useRouter();
  const [tools, setTools] = useState<Tools | null>(null);
  const [greeting, setGreeting] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [command, setCommand] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const data = await apiFetch<Tools>('/seller-tools');
    setTools(data);
    setGreeting(data.greeting ?? '');
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/tools');
      return;
    }
    load().catch(() => setMsg({ ok: false, text: t('Не удалось загрузить настройки.') }));
  }, [router, load, t]);

  async function run(fn: () => Promise<void>, ok: string, fail: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, fail) });
    } finally {
      setBusy(false);
    }
  }

  const toggleRaise = () =>
    tools &&
    run(
      async () => {
        const r = await apiFetch<Pick<Tools, 'autoRaise' | 'raise'>>('/seller-tools/auto-raise', {
          method: 'PUT',
          body: JSON.stringify({ on: !tools.autoRaise }),
        });
        setTools({ ...tools, ...r });
      },
      tools.autoRaise ? t('Автоподнятие выключено.') : t('Автоподнятие включено.'),
      t('Не удалось сохранить.'),
    );

  const saveGreeting = (text: string | null) =>
    tools &&
    run(
      async () => {
        const r = await apiFetch<{ greeting: string | null }>('/seller-tools/greeting', {
          method: 'PUT',
          body: JSON.stringify({ text }),
        });
        setTools({ ...tools, greeting: r.greeting });
        setGreeting(r.greeting ?? '');
      },
      text?.trim() ? t('Приветствие сохранено.') : t('Приветствие выключено.'),
      t('Не удалось сохранить.'),
    );

  function resetForm() {
    setEditing(null);
    setTitle('');
    setBody('');
    setCommand('');
  }

  function saveTemplate(e: FormEvent) {
    e.preventDefault();
    if (!tools) return;
    const payload = JSON.stringify({
      title: title.trim(),
      body: body.trim(),
      command: command.trim() || null,
    });
    void run(
      async () => {
        if (editing) {
          const r = await apiFetch<Template>(`/seller-tools/templates/${editing}`, {
            method: 'PUT',
            body: payload,
          });
          setTools({ ...tools, templates: tools.templates.map((x) => (x.id === r.id ? r : x)) });
        } else {
          const r = await apiFetch<Template>('/seller-tools/templates', {
            method: 'POST',
            body: payload,
          });
          setTools({ ...tools, templates: [...tools.templates, r] });
        }
        resetForm();
      },
      editing ? t('Заготовка изменена.') : t('Заготовка добавлена.'),
      t('Не удалось сохранить заготовку.'),
    );
  }

  const removeTemplate = (id: string) =>
    tools &&
    run(
      async () => {
        await apiFetch(`/seller-tools/templates/${id}`, { method: 'DELETE' });
        setTools({ ...tools, templates: tools.templates.filter((x) => x.id !== id) });
        if (editing === id) resetForm();
      },
      t('Заготовка удалена.'),
      t('Не удалось удалить заготовку.'),
    );

  const raise = tools?.raise;

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Инструменты продавца')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t(
            'Автоподнятие, приветствие, заготовки ответов, автоответы на команды и промокоды — без сторонних ботов с доступом к аккаунту.',
          )}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {msg && (
        <div
          className={msg.ok ? 'alert success' : 'alert error'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </div>
      )}

      {!tools || !raise ? (
        <div className="skeleton" style={{ height: 320 }} aria-busy="true" />
      ) : (
        <>
          <section className="card tools-card">
            <div className="tools-head">
              <h2 className="h2 tools-title">{t('Автоподнятие')}</h2>
              <button
                type="button"
                role="switch"
                className="switch"
                aria-checked={tools.autoRaise}
                aria-label={t('Поднимать лоты автоматически')}
                disabled={busy}
                onClick={() => void toggleRaise()}
              >
                <span className="switch-track" aria-hidden>
                  <span className="switch-thumb" />
                </span>
                <span className="switch-label" aria-hidden>
                  {tools.autoRaise ? t('Включено') : t('Выключено')}
                </span>
              </button>
            </div>
            <p className="muted tools-text">
              {t(
                'Лоты поднимаются сами, как только проходит пауза между поднятиями. У вас она {h} ч — с ростом продаж короче.',
                {
                  h: raise.everyHours,
                },
              )}
            </p>
            {tools.autoRaise && (
              <p className="hint">
                {raise.activeLots === 0
                  ? t('Активных лотов нет — поднимать нечего.')
                  : raise.nextInMinutes
                    ? t('Следующее поднятие — через {time}.', {
                        time: wait(raise.nextInMinutes, t),
                      })
                    : t('Лоты поднимутся в ближайшие минуты.')}
              </p>
            )}
          </section>

          <section className="card tools-card">
            <h2 className="h2 tools-title">{t('Приветствие')}</h2>
            <p className="muted tools-text">
              {t(
                'Уходит покупателю на первое сообщение в новом диалоге до покупки — с пометкой «автоответ». Контакты скрываются, как в чате.',
              )}
            </p>
            <form
              className="stack-form"
              style={{ gap: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                void saveGreeting(greeting);
              }}
            >
              <textarea
                className="input"
                rows={4}
                maxLength={GREETING_MAX}
                value={greeting}
                aria-label={t('Текст приветствия')}
                placeholder={t('Здравствуйте. Отвечаю в течение часа, товар в наличии.')}
                style={{ resize: 'vertical' }}
                onChange={(e) => setGreeting(e.target.value)}
              />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  className="btn"
                  type="submit"
                  disabled={busy || greeting === (tools.greeting ?? '')}
                >
                  {t('Сохранить')}
                </button>
                {tools.greeting && (
                  <button
                    className="chip"
                    type="button"
                    disabled={busy}
                    onClick={() => void saveGreeting(null)}
                  >
                    {t('Выключить')}
                  </button>
                )}
                <span className="hint" style={{ marginLeft: 'auto' }}>
                  {greeting.length} / {GREETING_MAX}
                </span>
              </div>
            </form>
          </section>

          <section className="card tools-card">
            <h2 className="h2 tools-title">{t('Заготовки ответов')}</h2>
            <p className="muted tools-text">
              {t(
                'Открываются кнопкой в поле сообщения и вставляются в него. {token} заменится на ник собеседника.',
                {
                  token: nameToken(t),
                },
              )}
            </p>
            {tools.templates.length > 0 && (
              <ul className="tools-templates">
                {tools.templates.map((tp) => (
                  <li key={tp.id} className="tools-template">
                    <div className="tools-template-main">
                      <div className="tools-template-title">
                        {tp.title}
                        {tp.command && <span className="cmd">{tp.command}</span>}
                      </div>
                      <div className="tools-template-body">{tp.body}</div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        className="chip"
                        type="button"
                        onClick={() => {
                          setEditing(tp.id);
                          setTitle(tp.title);
                          setBody(tp.body);
                          setCommand(tp.command ?? '');
                        }}
                      >
                        {t('Изменить')}
                      </button>
                      <button
                        className="chip"
                        type="button"
                        disabled={busy}
                        onClick={() => void removeTemplate(tp.id)}
                      >
                        {t('Удалить')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form className="stack-form" style={{ gap: 10 }} onSubmit={saveTemplate}>
              <input
                className="input"
                maxLength={60}
                value={title}
                aria-label={t('Название заготовки')}
                placeholder={t('Название, например «После оплаты»')}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className="input"
                rows={3}
                maxLength={2000}
                value={body}
                aria-label={t('Текст заготовки')}
                placeholder={t('{token}, спасибо за покупку. Данные для входа — выше в чате.', {
                  token: nameToken(t),
                })}
                style={{ resize: 'vertical' }}
                onChange={(e) => setBody(e.target.value)}
              />
              <input
                className="input input-mono"
                maxLength={COMMAND_MAX}
                value={command}
                aria-label={t('Команда для автоответа')}
                placeholder={t('Команда, например !оплата')}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setCommand(e.target.value)}
              />
              <p className="hint" style={{ margin: 0 }}>
                {t(
                  'Команда — по желанию: покупатель пишет её отдельным сообщением, и заготовка уходит сама, с пометкой «автоответ». Регистр не важен.',
                )}
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn"
                  type="submit"
                  disabled={busy || !title.trim() || !body.trim()}
                >
                  {editing ? t('Сохранить заготовку') : t('Добавить заготовку')}
                </button>
                {editing && (
                  <button className="chip" type="button" onClick={resetForm}>
                    {t('Отмена')}
                  </button>
                )}
              </div>
            </form>
          </section>

          <SellerPromos />
        </>
      )}
    </div>
  );
}
