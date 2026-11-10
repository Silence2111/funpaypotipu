'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, FileUp } from 'lucide-react';
import {
  IMPORT_MAX_FILE_ROWS,
  exportLots,
  importBatches,
  importTemplate,
  parseCsv,
  readImport,
  type ImportAttr,
  type ImportRead,
} from '@gamemarket/shared/lot-import';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';

interface Game {
  id: string;
  slug: string;
  title: string;
}
interface Category {
  id: string;
  slug: string;
  title: string;
  fulfillmentType: string;
  unitName?: string | null;
}
interface ExportedLot {
  id: string;
  title: string;
  description: string;
  price: string;
  stock: number | null;
  attributes: Record<string, unknown>;
}
interface Result {
  created: Array<{ line: number; id: string }>;
  updated: Array<{ line: number; id: string }>;
  unchanged: Array<{ line: number; id: string }>;
  failed: Array<{ line: number; message: string }>;
}

/** Из таблицы — только лоты целиком с выдачей вручную: у ключей склад, у валюты пачка. */
const importable = (c: Category) => c.fulfillmentType === 'manual' && !c.unitName;
/** Сколько строк показывать в предпросмотре; ошибки — все. */
const PREVIEW = 30;

/**
 * «Загрузить из таблицы»: строка CSV — лот. Продавец выбирает раздел,
 * скачивает шаблон с его столбцами, загружает файл или вставляет строки из
 * Excel — сайт сразу показывает, какие строки выставятся и что не так с
 * остальными. API проверяет каждую строку заново и выставляет годные.
 */
export default function ImportLotsPage() {
  return (
    <Suspense fallback={null}>
      <ImportLots />
    </Suspense>
  );
}

function ImportLots() {
  const t = useT();
  const router = useRouter();
  // С «Продавать» приходят с ?game=…&category=… — раздел уже выбран.
  const sp = useSearchParams();
  const presetGame = sp.get('game');
  const presetCategory = sp.get('category');
  const [games, setGames] = useState<Game[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState<Category | null>(null);
  const [attrs, setAttrs] = useState<ImportAttr[]>([]);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Большая таблица уходит порциями: сколько строк уже загружено.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Строки с ошибками из таблицы: после загрузки таблица очищается, а продавцу
  // надо знать, какие строки исправить и догрузить.
  const [skipped, setSkipped] = useState<Array<{ line: number; message: string }>>([]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/lots/import');
      return;
    }
    apiFetch<Game[]>('/catalog/games')
      .then(setGames)
      .catch(() => setError(t('Не удалось загрузить игры.')));
  }, [router, t]);

  // Раздел из адреса — когда игры загрузились.
  useEffect(() => {
    if (!presetGame || game || !games.length) return;
    const g = games.find((x) => x.slug === presetGame);
    if (g) void pickGame(g.id, presetCategory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, presetGame, presetCategory]);

  async function pickGame(id: string, categorySlug?: string | null) {
    const g = games.find((x) => x.id === id) ?? null;
    setGame(g);
    setCategory(null);
    setCategories([]);
    setAttrs([]);
    if (!g) return;
    const full = await apiFetch<{ categories: Category[] }>(`/catalog/games/${g.slug}`).catch(
      () => null,
    );
    const list = full?.categories ?? [];
    setCategories(list);
    const c = categorySlug ? list.find((x) => x.slug === categorySlug && importable(x)) : null;
    if (c) await pickCategory(c.id, list);
  }

  async function pickCategory(id: string, list: Category[] = categories) {
    const c = list.find((x) => x.id === id) ?? null;
    setCategory(c);
    setAttrs([]);
    setResult(null);
    if (!c) return;
    setAttrs(
      (await apiFetch<ImportAttr[]>(`/catalog/categories/${c.id}/attributes`).catch(() => [])) ??
        [],
    );
  }

  const read: ImportRead | null =
    category && text.trim() ? readImport(parseCsv(text), attrs) : null;

  // BOM — чтобы Excel открыл кириллицу без вопросов о кодировке.
  function save(csv: string, name: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadTemplate() {
    if (!game || !category) return;
    // С двумя строками-примерами: как заполнять. Сами примеры не выставятся.
    save(
      importTemplate(attrs, t.lang, { what: `${t.d(category.title)} ${t.d(game.title)}` }),
      `gamemarket-${game.slug}-${category.slug}.csv`,
    );
  }

  async function exportMine() {
    if (!game || !category) return;
    setNotice(null);
    try {
      const mine = await apiFetch<ExportedLot[]>(`/listings/export?categoryId=${category.id}`);
      if (!mine.length) {
        setNotice(t('В этом разделе нет ваших лотов, которые правятся таблицей.'));
        return;
      }
      save(exportLots(mine, attrs, t.lang), `gamemarket-${game.slug}-${category.slug}-mine.csv`);
    } catch (e) {
      setError(apiErrorMessage(e, t('Не получилось. Попробуйте ещё раз.')));
    }
  }

  /**
   * Порциями по 200 строк, по очереди: таблица на 1 000 лотов — пять
   * запросов, продавец видит, сколько уже загружено. Оборвалось посередине
   * — загруженное остаётся, сайт говорит, с какой строки продолжить.
   */
  async function submit() {
    if (!game || !category || !read?.lots.length) return;
    setBusy(true);
    setError(null);
    const all: Result = { created: [], updated: [], unchanged: [], failed: [] };
    const parts = importBatches(read.lots);
    setSkipped(read.errors);
    let done = 0;
    setProgress({ done: 0, total: read.lots.length });
    try {
      for (const lots of parts) {
        const r = await apiFetch<Result>('/listings/import', {
          method: 'POST',
          body: JSON.stringify({ gameId: game.id, categoryId: category.id, lots }),
        });
        all.created.push(...r.created);
        all.updated.push(...r.updated);
        all.unchanged.push(...r.unchanged);
        all.failed.push(...r.failed);
        done += lots.length;
        setProgress({ done, total: read.lots.length });
      }
      setResult(all);
      if (all.created.length || all.updated.length) {
        setText('');
        setFileName(null);
      }
    } catch (e) {
      const next = read.lots[done]?.line;
      if (done) {
        setResult(all);
        setText('');
        setFileName(null);
      }
      setError(
        done && next
          ? t(
              'Загружено строк: {done} из {total}. Остальные не ушли: {reason} Загрузите таблицу со строки {line} — уже загруженные строки уберите.',
              {
                done,
                total: read.lots.length,
                line: next,
                reason: apiErrorMessage(e, t('Не получилось.')),
              },
            )
          : apiErrorMessage(e, t('Не получилось. Попробуйте ещё раз.')),
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const edits = read?.lots.filter((l) => l.id).length ?? 0;
  const errorsByLine = new Map((read?.errors ?? []).map((e) => [e.line, e.message]));
  const preview = [
    ...(read?.lots ?? []).map((l) => ({
      line: l.line,
      title: l.title,
      price: l.price,
      stock: l.stock,
      edit: !!l.id,
      error: null,
    })),
    ...(read?.errors ?? []).map((e) => ({
      line: e.line,
      title: '',
      price: '',
      stock: null,
      edit: false,
      error: e.message,
    })),
  ].sort((a, b) => a.line - b.line);
  const shown = preview.filter((r, i) => r.error || i < PREVIEW);

  return (
    <div className="container stack-lg" style={{ paddingTop: 40, maxWidth: 880 }}>
      <div>
        <Link href="/cabinet/lots" className="faint back-link" style={{ fontSize: 14 }}>
          ← {t('Мои лоты')}
        </Link>
        <h1 className="h1" style={{ fontSize: 32, marginTop: 8 }}>
          {t('Загрузить из таблицы')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t(
            'Много лотов разом: строка таблицы — лот. Подойдёт CSV из Excel или Google Таблиц или строки, скопированные прямо из таблицы. Один раздел за раз, до {n} лотов; ключи, пополнения и валюта — по одному, через форму лота.',
            { n: IMPORT_MAX_FILE_ROWS.toLocaleString(t.locale) },
          )}
        </p>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <section className="card import-step" aria-labelledby="import-section">
        <h2 className="h2" id="import-section" style={{ fontSize: 18 }}>
          {t('1. Раздел')}
        </h2>
        <div className="import-pickers">
          <select
            className="input"
            aria-label={t('Игра')}
            value={game?.id ?? ''}
            onChange={(e) => void pickGame(e.target.value)}
          >
            <option value="">{t('Игра')}</option>
            {[...games]
              .sort((a, b) => t.d(a.title).localeCompare(t.d(b.title), t.locale))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {t.d(g.title)}
                </option>
              ))}
          </select>
          <select
            className="input"
            aria-label={t('Раздел')}
            value={category?.id ?? ''}
            disabled={!categories.length}
            onChange={(e) => void pickCategory(e.target.value)}
          >
            <option value="">{t('Раздел')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id} disabled={!importable(c)}>
                {importable(c)
                  ? t.d(c.title)
                  : t('{category} — по одному', { category: t.d(c.title) })}
              </option>
            ))}
          </select>
        </div>
        {category && (
          <div className="import-columns">
            <p className="hint" style={{ margin: 0 }}>
              {t('Столбцы: {columns}. Обязательные — со звёздочкой, порядок любой.', {
                columns: [
                  `${t('Название')}*`,
                  `${t('Описание')}*`,
                  `${t('Цена, ₽')}*`,
                  t('Наличие'),
                  ...attrs.map((a) => `${t.d(a.label)}${a.isRequired ? '*' : ''}`),
                ].join(', '),
              })}
            </p>
            {attrs.some((a) => a.type === 'enum' && a.options?.length) && (
              <details>
                <summary className="faint">{t('Допустимые значения')}</summary>
                <ul className="import-values">
                  {attrs
                    .filter((a) => a.type === 'enum' && a.options?.length)
                    .map((a) => (
                      <li key={a.key}>
                        <b>{t.d(a.label)}:</b> {a.options!.join(', ')}
                      </li>
                    ))}
                  {attrs
                    .filter((a) => a.type === 'bool')
                    .map((a) => (
                      <li key={a.key}>
                        <b>{t.d(a.label)}:</b> {t('да или нет')}
                      </li>
                    ))}
                </ul>
              </details>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn secondary" onClick={downloadTemplate}>
                <Download size={16} strokeWidth={1.75} aria-hidden /> {t('Скачать шаблон')}
              </button>
              <button type="button" className="btn secondary" onClick={() => void exportMine()}>
                <Download size={16} strokeWidth={1.75} aria-hidden /> {t('Выгрузить мои лоты')}
              </button>
            </div>
            <p className="hint" style={{ margin: 0 }}>
              {notice ??
                t(
                  'В выгрузке — столбец ID: поправьте цены, описания, наличие и загрузите таблицу обратно. Строка с ID меняет лот, без ID — выставляет новый; пустая ячейка у лота с ID — «оставить как есть».',
                )}
            </p>
          </div>
        )}
      </section>

      {category && (
        <section className="card import-step" aria-labelledby="import-file">
          <h2 className="h2" id="import-file" style={{ fontSize: 18 }}>
            {t('2. Таблица')}
          </h2>
          <label className="btn secondary import-file">
            <FileUp size={16} strokeWidth={1.75} aria-hidden />
            {fileName ?? t('Выбрать файл CSV')}
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFileName(f.name);
                setResult(null);
                setText(await f.text());
              }}
            />
          </label>
          <textarea
            className="input"
            rows={6}
            value={text}
            placeholder={t('…или вставьте строки таблицы вместе с заголовками')}
            aria-label={t('Строки таблицы')}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(null);
              setResult(null);
            }}
          />

          {read?.fatal && (
            <div className="alert error" role="alert">
              {t.d(read.fatal)}
            </div>
          )}
          {read && !read.fatal && (
            <>
              <p className="import-summary" role="status">
                {edits
                  ? t('Новых: {n} · изменить: {m}', { n: read.lots.length - edits, m: edits })
                  : t('Готово к выставлению: {ok}', { ok: read.lots.length })}
                {read.errors.length > 0 && (
                  <span className="import-bad">
                    {' '}
                    · {t('с ошибками: {n}', { n: read.errors.length })}
                  </span>
                )}
              </p>
              <div className="stats-table import-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t('Строка')}</th>
                      <th scope="col">{t('Название')}</th>
                      <th scope="col">{t('Что будет')}</th>
                      <th scope="col">{t('Цена')}</th>
                      <th scope="col">{t('Наличие')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) =>
                      r.error ? (
                        <tr key={r.line} className="import-row-bad">
                          <td className="num">{r.line}</td>
                          <td colSpan={4}>{t.d(r.error)}</td>
                        </tr>
                      ) : (
                        <tr key={r.line}>
                          <td className="num">{r.line}</td>
                          <td>{r.title}</td>
                          <td className="faint">{r.edit ? t('изменить') : t('новый')}</td>
                          <td className="num">{formatPrice(r.price, 'RUB', t)}</td>
                          <td className="num">{r.stock ?? '—'}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              {preview.length > shown.length && (
                <p className="hint" style={{ margin: 0 }}>
                  {t('И ещё {n} строк без ошибок.', { n: preview.length - shown.length })}
                </p>
              )}
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !read.lots.length}
                  onClick={() => void submit()}
                >
                  {progress
                    ? t('Загружаем: {done} из {total}', progress)
                    : edits
                      ? t('Сохранить: {lots}', {
                          lots: t.n(read.lots.length, 'лот', 'лота', 'лотов'),
                        })
                      : t('Выставить {lots}', {
                          lots: t.n(read.lots.length, 'лот', 'лота', 'лотов'),
                        })}
                </button>
                {errorsByLine.size > 0 && (
                  <span className="hint">
                    {t('Строки с ошибками пропустим — исправьте их и загрузите отдельно.')}
                  </span>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {result && (
        <section className="card import-step" aria-labelledby="import-result" role="status">
          <h2 className="h2" id="import-result" style={{ fontSize: 18 }}>
            {result.updated.length || result.unchanged.length
              ? t('Выставлено: {n} · изменено: {m} · без изменений: {k}', {
                  n: result.created.length,
                  m: result.updated.length,
                  k: result.unchanged.length,
                })
              : t('Выставлено: {n}', { n: result.created.length })}
          </h2>
          {skipped.length > 0 && (
            <p className="import-bad" style={{ margin: 0 }}>
              {t(
                'Не выставлены строки с ошибками: {lines} — исправьте их и загрузите только эти строки.',
                {
                  lines:
                    skipped
                      .slice(0, 20)
                      .map((e) => e.line)
                      .join(', ') + (skipped.length > 20 ? ` … (${skipped.length})` : ''),
                },
              )}
            </p>
          )}
          {result.failed.length > 0 && (
            <ul className="import-failed">
              {result.failed.map((f) => (
                <li key={f.line}>
                  {t('Строка {line}: {message}', { line: f.line, message: t.d(f.message) })}
                </li>
              ))}
            </ul>
          )}
          <div>
            <Link href="/cabinet/lots" className="btn secondary">
              {t('К моим лотам')}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
