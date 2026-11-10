'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { GameTile } from '@/components/cards';
import { Empty } from './shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Attribute {
  id: string;
  key: string;
  label: string;
  type: 'enum' | 'string' | 'int' | 'bool';
  options: string[] | null;
  isRequired: boolean;
  isFilter: boolean;
  editedAt: string | null;
}
interface Category {
  id: string;
  slug: string;
  title: string;
  segment: string;
  fulfillmentType: string;
  unitName: string | null;
  pricePerUnits: number | null;
  isActive: boolean;
  activeListings: number;
  attributes: Attribute[];
}
interface Game {
  id: string;
  slug: string;
  title: string;
  kind: 'game' | 'mobile' | 'app';
  aliases: string[];
  coverUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  categories: Category[];
}

const KIND: Record<Game['kind'], string> = { game: 'игра', mobile: 'мобильная игра', app: 'приложение или сервис' };
const SEGMENT: Record<string, string> = {
  accounts: 'аккаунты',
  currency: 'валюта',
  items: 'предметы',
  key: 'ключи',
  topup: 'донат',
  service: 'услуги',
};
const FULFILLMENT: Record<string, string> = { manual: 'вручную', auto_key: 'со склада сразу', provider: 'через провайдера' };
const TYPE: Record<Attribute['type'], string> = { enum: 'выбор из списка', string: 'текст', int: 'число', bool: 'да / нет' };

const LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '',
  ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
/** «Genshin Impact» → «genshin-impact», «Мир танков» → «mir-tankov». */
const slugOf = (title: string) =>
  title
    .toLowerCase()
    .split('')
    .map((c) => LAT[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Каталог: игры, разделы и поля фильтров — добавить, изменить, скрыть,
 * переставить, обложка игры. Раньше всё это было только в сиде, и игру под
 * пришедшего продавца заводил выкат программиста. Каждое действие — в
 * журнале (раздел «Каталог»), изменённое здесь сид при выкате не трогает.
 * Только администратору.
 */
export function CatalogSection() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [q, setQ] = useState('');
  const [hidden, setHidden] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setGames(await apiFetch<Game[]>('/admin/catalog'));
    } catch (e) {
      setGames([]);
      setMsg({ ok: false, text: apiErrorMessage(e, 'Не удалось загрузить каталог.') });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** Действие и свежий каталог; ошибка — текстом API. */
  async function run(fn: () => Promise<unknown>, done: string, fallback: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await load();
      setMsg({ ok: true, text: done });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, fallback) });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const send = (path: string, method: string, body?: unknown) =>
    apiFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (games ?? []).filter(
      (g) =>
        (hidden || g.isActive) &&
        (!term || g.title.toLowerCase().includes(term) || g.slug.includes(term) || g.aliases.some((a) => a.toLowerCase().includes(term))),
    );
  }, [games, q, hidden]);

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Игра, адрес или синоним"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск игр" />
        <button type="button" className="chip" aria-pressed={hidden} onClick={() => setHidden((v) => !v)}>
          со скрытыми
        </button>
      </div>
      {msg && <div className={msg.ok ? 'alert success' : 'alert error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <NewGame busy={busy} onCreate={(body) => run(() => send('/admin/catalog/games', 'POST', body), `Игра «${body.title}» добавлена.`, 'Не удалось добавить игру.')} />
      {games === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : shown.length === 0 ? (
        <Empty>Ничего не нашлось.</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {shown.map((g) => (
            <GameCard key={g.id} game={g} open={open === g.id} busy={busy}
              onToggle={() => setOpen((o) => (o === g.id ? null : g.id))} run={run} send={send} />
          ))}
        </div>
      )}
      <p className="faint" style={{ fontSize: 13, margin: 0 }}>
        Игр: {games?.length ?? 0}. Изменённое здесь выкат не перезаписывает; все действия — в журнале,{' '}
        <Link href="/admin?tab=audit&kind=catalog">раздел «Каталог»</Link>.
      </p>
    </section>
  );
}

type Run = (fn: () => Promise<unknown>, done: string, fallback: string) => Promise<boolean>;
type Send = (path: string, method: string, body?: unknown) => Promise<unknown>;

function NewGame({ busy, onCreate }: { busy: boolean; onCreate: (b: { title: string; slug: string; kind: string; aliases: string[] }) => Promise<boolean> }) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [kind, setKind] = useState<Game['kind']>('game');
  const [aliases, setAliases] = useState('');
  return (
    <details className="card" style={{ padding: 16 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Добавить игру</summary>
      <form
        className="stack-form"
        style={{ gap: 10, marginTop: 12 }}
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          if (await onCreate({ title: title.trim(), slug: slug.trim(), kind, aliases: list(aliases) })) {
            setTitle('');
            setSlug('');
            setTouched(false);
            setAliases('');
          }
        }}
      >
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: 2, minWidth: 180 }} placeholder="Название: Throne and Liberty" required
            value={title} onChange={(e) => {
              setTitle(e.target.value);
              if (!touched) setSlug(slugOf(e.target.value));
            }} aria-label="Название игры" />
          <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="адрес: throne-and-liberty" required
            value={slug} onChange={(e) => {
              setTouched(true);
              setSlug(e.target.value);
            }} aria-label="Адрес игры" />
          <select className="input" style={{ flex: 1, minWidth: 140 }} value={kind} onChange={(e) => setKind(e.target.value as Game['kind'])} aria-label="Вид">
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <input className="input" placeholder="Синонимы для поиска через запятую: тл, тхрон" value={aliases}
          onChange={(e) => setAliases(e.target.value)} aria-label="Синонимы" />
        <p className="hint">Адрес — в ссылке: /igra/{slug || 'адрес'}; потом не меняется. Новая игра — без разделов, их добавить ниже.</p>
        <button className="btn" type="submit" disabled={busy || !title.trim() || !slug.trim()} style={{ alignSelf: 'flex-start' }}>
          Добавить
        </button>
      </form>
    </details>
  );
}

function GameCard({ game: g, open, busy, onToggle, run, send }: { game: Game; open: boolean; busy: boolean; onToggle: () => void; run: Run; send: Send }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ title: g.title, kind: g.kind, aliases: g.aliases.join(', '), popular: g.sortOrder < 100 ? String(g.sortOrder) : '' });
  const lots = g.categories.reduce((n, c) => n + c.activeListings, 0);

  async function cover(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    const token = getToken();
    await run(
      async () => {
        const res = await fetch(`${API_URL}/api/admin/catalog/games/${g.id}/cover`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!res.ok) throw new Error(await res.text());
      },
      `Обложка «${g.title}» загружена.`,
      'Обложка не загрузилась.',
    );
  }

  return (
    <article className="card" style={{ padding: 16 }}>
      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
          <GameTile title={g.title} size={14} cover={g.coverUrl} />
        </span>
        <span style={{ flex: 1, minWidth: 180 }}>
          <Link href={`/igra/${g.slug}`} style={{ fontWeight: 600 }}>{g.title}</Link>{' '}
          {!g.isActive && <span className="badge warning">скрыта</span>}
          <span className="faint" style={{ display: 'block', fontSize: 13 }}>
            /{g.slug} · {KIND[g.kind]} · {g.sortOrder < 100 ? `в популярных: ${g.sortOrder}` : 'не в популярных'} · разделов {g.categories.length} · в продаже {lots}
          </span>
        </span>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="chip" aria-expanded={open} onClick={onToggle}>Разделы</button>
          <button type="button" className="chip" onClick={() => setEdit((v) => !v)}>Изменить</button>
          <button type="button" className="chip" disabled={busy}
            onClick={() => void run(() => send(`/admin/catalog/games/${g.id}`, 'PATCH', { isActive: !g.isActive }), g.isActive ? `«${g.title}» скрыта с витрины.` : `«${g.title}» снова на витрине.`, 'Не удалось изменить игру.')}>
            {g.isActive ? 'Скрыть' : 'Показать'}
          </button>
        </span>
      </div>

      {edit && (
        <form className="stack-form" style={{ gap: 8, marginTop: 12 }}
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            const ok = await run(
              () => send(`/admin/catalog/games/${g.id}`, 'PATCH', {
                title: form.title.trim(),
                kind: form.kind,
                aliases: list(form.aliases),
                sortOrder: form.popular ? Number(form.popular) : 100,
              }),
              `«${form.title.trim()}» сохранена.`,
              'Не удалось сохранить игру.',
            );
            if (ok) setEdit(false);
          }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 2, minWidth: 180 }} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Название" required />
            <select className="input" style={{ flex: 1, minWidth: 140 }} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Game['kind'] })} aria-label="Вид">
              {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className="input" style={{ width: 150 }} inputMode="numeric" placeholder="место в популярных" value={form.popular}
              onChange={(e) => setForm({ ...form, popular: e.target.value.replace(/\D/g, '').slice(0, 3) })} aria-label="Место в популярных, 1–99; пусто — не в популярных" />
          </div>
          <input className="input" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} aria-label="Синонимы через запятую" placeholder="синонимы через запятую" />
          <span className="row" style={{ gap: 8 }}>
            <button className="btn" type="submit" disabled={busy}>Сохранить</button>
            <button className="chip" type="button" onClick={() => setEdit(false)}>Отмена</button>
          </span>
        </form>
      )}

      {open && (
        <div className="stack-form" style={{ gap: 10, marginTop: 14 }}>
          <label className="row faint" style={{ gap: 8, fontSize: 13, alignItems: 'center', flexWrap: 'wrap' }}>
            Обложка — PNG, JPEG или WebP до 2 МБ, квадратная:
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void cover(f);
                e.target.value = '';
              }} />
          </label>
          {g.categories.length === 0 && <Empty>Разделов пока нет — без них игра на витрине пустая.</Empty>}
          {g.categories.map((c, i) => (
            <CategoryRow key={c.id} c={c} first={i === 0} last={i === g.categories.length - 1} busy={busy} run={run} send={send}
              move={(dir) => {
                const ids = g.categories.map((x) => x.id);
                [ids[i], ids[i + dir]] = [ids[i + dir]!, ids[i]!];
                void run(() => send(`/admin/catalog/games/${g.id}/categories/order`, 'PUT', { ids }), 'Порядок разделов сохранён.', 'Не удалось переставить.');
              }} />
          ))}
          <NewCategory busy={busy} onCreate={(body) => run(() => send(`/admin/catalog/games/${g.id}/categories`, 'POST', body), `Раздел «${body.title}» добавлен.`, 'Не удалось добавить раздел.')} />
        </div>
      )}
    </article>
  );
}

function NewCategory({ busy, onCreate }: { busy: boolean; onCreate: (b: Record<string, unknown> & { title: string }) => Promise<boolean> }) {
  const [f, setF] = useState({ title: '', slug: '', touched: false, segment: 'accounts', fulfillmentType: 'manual', unitName: '', per: '' });
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Добавить раздел</summary>
      <form className="stack-form" style={{ gap: 8, marginTop: 8 }}
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          const ok = await onCreate({
            title: f.title.trim(),
            slug: f.slug.trim(),
            segment: f.segment,
            fulfillmentType: f.fulfillmentType,
            ...(f.segment === 'currency' && f.unitName.trim() ? { unitName: f.unitName.trim(), pricePerUnits: Number(f.per) || 1 } : {}),
          });
          if (ok) setF({ ...f, title: '', slug: '', touched: false, unitName: '', per: '' });
        }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: 2, minWidth: 160 }} placeholder="Название: Золото" required value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value, slug: f.touched ? f.slug : slugOf(e.target.value) })} aria-label="Название раздела" />
          <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="адрес: gold" required value={f.slug}
            onChange={(e) => setF({ ...f, slug: e.target.value, touched: true })} aria-label="Адрес раздела" />
          <select className="input" style={{ flex: 1, minWidth: 130 }} value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })} aria-label="Тип товара">
            {Object.entries(SEGMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input" style={{ flex: 1, minWidth: 150 }} value={f.fulfillmentType} onChange={(e) => setF({ ...f, fulfillmentType: e.target.value })} aria-label="Выдача">
            {Object.entries(FULFILLMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {f.segment === 'currency' && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 160 }} placeholder="единица: золото" value={f.unitName} onChange={(e) => setF({ ...f, unitName: e.target.value })} aria-label="Единица" />
            <input className="input" style={{ width: 160 }} inputMode="numeric" placeholder="цена за: 1000" value={f.per} onChange={(e) => setF({ ...f, per: e.target.value.replace(/\D/g, '') })} aria-label="Цена за сколько единиц" />
          </div>
        )}
        <button className="btn" type="submit" disabled={busy || !f.title.trim() || !f.slug.trim()} style={{ alignSelf: 'flex-start' }}>Добавить раздел</button>
      </form>
    </details>
  );
}

function CategoryRow({ c, first, last, busy, run, send, move }: { c: Category; first: boolean; last: boolean; busy: boolean; run: Run; send: Send; move: (dir: -1 | 1) => void }) {
  const [fields, setFields] = useState(false);
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(c.title);
  return (
    <div className="card flat" style={{ padding: 12, background: 'var(--page)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 2 }}>
          <button type="button" className="chip" disabled={busy || first} onClick={() => move(-1)} aria-label={`«${c.title}» выше`}>↑</button>
          <button type="button" className="chip" disabled={busy || last} onClick={() => move(1)} aria-label={`«${c.title}» ниже`}>↓</button>
        </span>
        <span style={{ flex: 1, minWidth: 160 }}>
          <b>{c.title}</b> {!c.isActive && <span className="badge warning">скрыт</span>}
          <span className="faint" style={{ display: 'block', fontSize: 13 }}>
            /{c.slug} · {SEGMENT[c.segment] ?? c.segment} · выдача {FULFILLMENT[c.fulfillmentType] ?? c.fulfillmentType}
            {c.unitName ? ` · ${c.unitName}, цена за ${c.pricePerUnits ?? 1}` : ''} · в продаже {c.activeListings} · полей {c.attributes.length}
          </span>
        </span>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="chip" aria-expanded={fields} onClick={() => setFields((v) => !v)}>Поля</button>
          <button type="button" className="chip" onClick={() => setEdit((v) => !v)}>Переименовать</button>
          <button type="button" className="chip" disabled={busy}
            onClick={() => void run(() => send(`/admin/catalog/categories/${c.id}`, 'PATCH', { isActive: !c.isActive }), c.isActive ? `Раздел «${c.title}» скрыт.` : `Раздел «${c.title}» снова на витрине.`, 'Не удалось изменить раздел.')}>
            {c.isActive ? 'Скрыть' : 'Показать'}
          </button>
        </span>
      </div>
      {edit && (
        <form className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (await run(() => send(`/admin/catalog/categories/${c.id}`, 'PATCH', { title: title.trim() }), `Раздел «${title.trim()}» сохранён.`, 'Не удалось сохранить раздел.')) setEdit(false);
          }}>
          <input className="input" style={{ flex: 1, minWidth: 160 }} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Название раздела" required />
          <button className="btn" type="submit" disabled={busy}>Сохранить</button>
        </form>
      )}
      {fields && <Fields c={c} busy={busy} run={run} send={send} />}
    </div>
  );
}

function Fields({ c, busy, run, send }: { c: Category; busy: boolean; run: Run; send: Send }) {
  const [f, setF] = useState({ key: '', label: '', type: 'enum' as Attribute['type'], options: '', isRequired: false });
  return (
    <div className="stack-form" style={{ gap: 6, marginTop: 10 }}>
      {c.attributes.length === 0 && <span className="faint" style={{ fontSize: 13 }}>Полей нет — лоты выставляются без характеристик.</span>}
      {c.attributes.map((a, i) => (
        <div key={a.id} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }}>
          <span className="row" style={{ gap: 2 }}>
            <button type="button" className="chip" disabled={busy || i === 0} aria-label={`«${a.label}» выше`}
              onClick={() => {
                const ids = c.attributes.map((x) => x.id);
                [ids[i], ids[i - 1]] = [ids[i - 1]!, ids[i]!];
                void run(() => send(`/admin/catalog/categories/${c.id}/attributes/order`, 'PUT', { ids }), 'Порядок полей сохранён.', 'Не удалось переставить.');
              }}>↑</button>
          </span>
          <span style={{ flex: 1, minWidth: 160 }}>
            {a.label} <span className="faint">({a.key}) · {TYPE[a.type]}{a.isRequired ? ' · обязательное' : ''}{a.isFilter ? ' · в фильтрах' : ''}</span>
            {a.options && <span className="faint" style={{ display: 'block', fontSize: 13 }}>{a.options.join(', ')}</span>}
          </span>
          <button type="button" className="chip" disabled={busy}
            onClick={() => void run(() => send(`/admin/catalog/attributes/${a.id}`, 'PATCH', { isRequired: !a.isRequired }), `Поле «${a.label}» ${a.isRequired ? 'необязательное' : 'обязательное'}.`, 'Не удалось изменить поле.')}>
            {a.isRequired ? 'Сделать необязательным' : 'Сделать обязательным'}
          </button>
          {a.type === 'enum' && (
            <button type="button" className="chip" disabled={busy}
              onClick={() => {
                const next = window.prompt(`Варианты «${a.label}» через запятую`, (a.options ?? []).join(', '));
                if (next !== null) void run(() => send(`/admin/catalog/attributes/${a.id}`, 'PATCH', { options: list(next) }), `Варианты «${a.label}» сохранены.`, 'Не удалось сохранить варианты.');
              }}>
              Варианты
            </button>
          )}
          <button type="button" className="chip" disabled={busy}
            onClick={() => {
              if (window.confirm(`Убрать поле «${a.label}»? Из формы и фильтров оно уйдёт; в старых лотах значения останутся, но не будут видны.`)) {
                void run(() => send(`/admin/catalog/attributes/${a.id}`, 'DELETE'), `Поле «${a.label}» убрано.`, 'Не удалось убрать поле.');
              }
            }}>
            Убрать
          </button>
        </div>
      ))}
      <form className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          const ok = await run(
            () => send(`/admin/catalog/categories/${c.id}/attributes`, 'POST', {
              key: f.key.trim(),
              label: f.label.trim(),
              type: f.type,
              isRequired: f.isRequired,
              ...(f.type === 'enum' ? { options: list(f.options) } : {}),
            }),
            `Поле «${f.label.trim()}» добавлено.`,
            'Не удалось добавить поле.',
          );
          if (ok) setF({ key: '', label: '', type: 'enum', options: '', isRequired: false });
        }}>
        <input className="input" style={{ flex: 1, minWidth: 170 }} placeholder="Подпись: Сервер" value={f.label} required
          onChange={(e) => setF({ ...f, label: e.target.value, key: f.key || slugOf(e.target.value).replace(/-/g, '_').replace(/^[^a-z]+/, '') })} aria-label="Подпись поля" />
        <input className="input" style={{ width: 150 }} placeholder="ключ: server" value={f.key} required onChange={(e) => setF({ ...f, key: e.target.value })} aria-label="Ключ поля" />
        <select className="input" style={{ width: 190 }} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Attribute['type'] })} aria-label="Тип поля">
          {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {f.type === 'enum' && (
          <input className="input" style={{ flex: 2, minWidth: 240 }} placeholder="варианты через запятую: EU, NA, Asia" value={f.options}
            onChange={(e) => setF({ ...f, options: e.target.value })} aria-label="Варианты" />
        )}
        <label className="row" style={{ gap: 4, fontSize: 13, alignItems: 'center' }}>
          <input type="checkbox" checked={f.isRequired} onChange={(e) => setF({ ...f, isRequired: e.target.checked })} /> обязательное
        </label>
        <button className="chip" type="submit" disabled={busy || !f.label.trim() || !f.key.trim()}>Добавить поле</button>
      </form>
    </div>
  );
}
