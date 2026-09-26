'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Game { id: string; slug: string; title: string }
interface Category { id: string; slug: string; title: string; fulfillmentType: string }
interface Attr { key: string; label: string; type: string; options?: string[] | null; isRequired: boolean }

export default function NewListingPage() {
  const router = useRouter();
  const [games, setGames] = useState<Game[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [gameId, setGameId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [images, setImages] = useState<{ key: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<{ feeSeller: string; sellerPayout: string; level: { label: string } | null } | null>(null);
  const [attrs, setAttrs] = useState<Attr[]>([]);
  const [attrValues, setAttrValues] = useState<Record<string, string | boolean>>({});
  const [uploadFailed, setUploadFailed] = useState(0);
  // Ошибки у конкретных полей, показываются после ухода из поля или отправки
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/register?next=${encodeURIComponent('/cabinet/new')}&seller=1`);
      return;
    }
    apiFetch<Game[]>('/catalog/games').then(setGames).catch(() => {});
  }, [router]);

  // Живое превью комиссии/выплаты с учётом уровня продавца.
  useEffect(() => {
    const rub = parseFloat(price.replace(',', '.'));
    if (!categoryId || !(rub > 0)) {
      setQuote(null);
      return;
    }
    const t = setTimeout(() => {
      const p = new URLSearchParams({ categoryId, price: String(Math.round(rub * 100)), currency: 'RUB' });
      apiFetch<{ feeSeller: string; sellerPayout: string; level: { label: string } | null }>(`/fees/quote?${p}`)
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 400);
    return () => clearTimeout(t);
  }, [categoryId, price]);

  // Атрибуты выбранной категории (характеристики/фильтры как на FunPay).
  useEffect(() => {
    setAttrs([]);
    setAttrValues({});
    if (!categoryId) return;
    apiFetch<Attr[]>(`/catalog/categories/${categoryId}/attributes`)
      .then(setAttrs)
      .catch(() => setAttrs([]));
  }, [categoryId]);

  async function onGame(slug: string) {
    const g = games.find((x) => x.slug === slug);
    setGameId(g?.id ?? '');
    setCategoryId('');
    if (!slug) return setCategories([]);
    const full = await apiFetch<Game & { categories: Category[] }>(`/catalog/games/${slug}`);
    setCategories(full.categories);
  }

  async function onImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    setUploading(true);
    const token = getToken();
    for (const f of files.slice(0, 12)) {
      try {
        const fd = new FormData();
        fd.append('file', f);
        const res = await fetch(`${API_URL}/api/listings/uploads`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!res.ok) {
          setUploadFailed((n) => n + 1);
          continue;
        }
        const { key } = (await res.json()) as { key: string };
        setImages((prev) => [...prev, { key, url: URL.createObjectURL(f) }]);
      } catch {
        setUploadFailed((n) => n + 1);
      }
    }
    setUploading(false);
  }

  const rubValue = parseFloat(price.replace(',', '.').replace(/\s/g, ''));
  const fieldErrors: Record<string, string | null> = {
    game: gameId ? null : 'Выберите игру',
    category: categoryId ? null : 'Выберите, что продаёте',
    title: title.trim().length >= 3 ? null : 'Название — от 3 знаков: его видят в каталоге',
    description: description.trim() ? null : 'Опишите, что получит покупатель и как передаёте',
    price: rubValue > 0 ? null : 'Цена в рублях, например 490',
  };
  const showErr = (k: string) => (touched[k] ? fieldErrors[k] : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setTouched({ game: true, category: true, title: true, description: true, price: true });
    if (Object.values(fieldErrors).some(Boolean)) {
      setErr('Лот не опубликован — поправьте отмеченные поля.');
      return;
    }
    const missing = attrs.find((a) => a.isRequired && !attrValues[a.key]);
    if (missing) {
      setErr(`Укажите характеристику «${missing.label}»`);
      return;
    }
    const cleanAttrs: Record<string, string | boolean> = {};
    for (const a of attrs) {
      const v = attrValues[a.key];
      if (v !== undefined && v !== '' && v !== false) cleanAttrs[a.key] = v;
    }
    setBusy(true);
    try {
      const created = await apiFetch<{ id: string }>('/listings', {
        method: 'POST',
        body: JSON.stringify({
          gameId,
          categoryId,
          title: title.trim(),
          description: description.trim(),
          price: String(Math.round(rubValue * 100)),
          currency: 'RUB',
          attributes: cleanAttrs,
          images: images.map((i) => i.key),
        }),
      });
      router.push(`/lot/${created.id}?created=1`);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось опубликовать лот. Попробуйте ещё раз через минуту.'));
      setBusy(false);
    }
  }

  const selectedCategory = categories.find((c) => c.id === categoryId);

  return (
    <div className="container" style={{ maxWidth: 600, paddingTop: 40 }}>
      <h1 className="h1" style={{ fontSize: 32 }}>Новый лот</h1>
      <p className="muted" style={{ margin: '8px 0 24px' }}>
        Лот появится в каталоге сразу. Деньги за продажу придут на баланс, когда покупатель подтвердит получение.
      </p>
      <form onSubmit={submit} className="card stack-form" style={{ gap: 18, padding: 24 }} noValidate>
        <div className="field">
          <label className="label" htmlFor="game">Игра</label>
          <select id="game" className="input" value={games.find((g) => g.id === gameId)?.slug ?? ''}
            onChange={(e) => onGame(e.target.value)} onBlur={() => touch('game')} aria-invalid={!!showErr('game')}>
            <option value="">Выберите игру</option>
            {games.map((g) => (
              <option key={g.id} value={g.slug}>{g.title}</option>
            ))}
          </select>
          {showErr('game') && <p className="field-error">{showErr('game')}</p>}
        </div>

        <div className="field">
          <label className="label" htmlFor="category">Что продаёте</label>
          <select id="category" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            onBlur={() => touch('category')} disabled={!categories.length} aria-invalid={!!showErr('category')}>
            <option value="">{categories.length ? 'Выберите категорию' : 'Сначала выберите игру'}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
          {showErr('category') ? (
            <p className="field-error">{showErr('category')}</p>
          ) : selectedCategory?.fulfillmentType === 'auto_key' ? (
            <p className="hint">Ключи загрузите на склад после публикации — покупатель получит ключ сразу после оплаты.</p>
          ) : null}
        </div>

        {attrs.length > 0 && (
          <div className="stack-form" style={{ gap: 14 }}>
            {attrs.map((a) => (
              <div key={a.key} className="field">
                <label className="label" htmlFor={`attr-${a.key}`}>
                  {a.label}{a.isRequired ? '' : ' — необязательно'}
                </label>
                {a.type === 'enum' && a.options ? (
                  <select id={`attr-${a.key}`} className="input" value={String(attrValues[a.key] ?? '')}
                    onChange={(e) => setAttrValues((v) => ({ ...v, [a.key]: e.target.value }))}>
                    <option value="">Выберите</option>
                    {a.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : a.type === 'bool' ? (
                  <label className="row" style={{ gap: 8, fontSize: 14, minHeight: 44 }}>
                    <input id={`attr-${a.key}`} type="checkbox" checked={!!attrValues[a.key]}
                      style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                      onChange={(e) => setAttrValues((v) => ({ ...v, [a.key]: e.target.checked }))} /> Да
                  </label>
                ) : (
                  <input id={`attr-${a.key}`} className="input" value={String(attrValues[a.key] ?? '')}
                    onChange={(e) => setAttrValues((v) => ({ ...v, [a.key]: e.target.value }))} />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="title">Название</label>
          <input id="title" className="input" placeholder="Например, Аккаунт CS2, Prime, 800 часов" value={title} maxLength={120}
            onChange={(e) => setTitle(e.target.value)} onBlur={() => touch('title')} aria-invalid={!!showErr('title')} />
          {showErr('title') && <p className="field-error">{showErr('title')}</p>}
        </div>

        <div className="field">
          <label className="label" htmlFor="description">Описание</label>
          <textarea id="description" className="input" style={{ minHeight: 120, resize: 'vertical' }}
            placeholder="Что входит, как передаёте, сколько ждать. Чем точнее — тем меньше споров."
            value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => touch('description')}
            aria-invalid={!!showErr('description')} />
          {showErr('description') && <p className="field-error">{showErr('description')}</p>}
        </div>

        <div className="field">
          <label className="label" htmlFor="price">Цена, ₽</label>
          <input id="price" className="input" placeholder="490" inputMode="decimal" value={price} style={{ maxWidth: 220 }}
            onChange={(e) => setPrice(e.target.value)} onBlur={() => touch('price')} aria-invalid={!!showErr('price')} />
          {showErr('price') && <p className="field-error">{showErr('price')}</p>}
        </div>

        {quote ? (
          <div className="card flat" style={{ padding: 16, background: 'var(--page)' }}>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
              <span className="muted">Комиссия площадки</span>
              <span>−{(Number(quote.feeSeller) / 100).toLocaleString('ru-RU')} ₽</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 15, fontWeight: 700, marginTop: 6 }}>
              <span>Вы получите</span>
              <span style={{ color: 'var(--success)' }}>{(Number(quote.sellerPayout) / 100).toLocaleString('ru-RU')} ₽</span>
            </div>
            {quote.level && <p className="hint" style={{ marginTop: 6 }}>Ваш уровень: {quote.level.label}</p>}
          </div>
        ) : (
          <p className="hint">Укажите категорию и цену — покажем комиссию и сумму, которую вы получите.</p>
        )}

        <div className="field">
          <span className="label">Фото — необязательно</span>
          <label className="btn secondary" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
            {uploading ? 'Загружаем…' : 'Добавить фото'}
            <input type="file" accept="image/*" multiple onChange={onImages} style={{ display: 'none' }} />
          </label>
          {uploadFailed > 0 && (
            <p className="field-error">
              Фото не загрузилось: хранилище картинок на стенде не подключено. Лот можно опубликовать без фото.
            </p>
          )}
          {images.length > 0 && (
            <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {images.map((im, i) => (
                <span key={i} style={{ position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    className="chip"
                    style={{ position: 'absolute', top: -10, right: -10, minHeight: 28, width: 28, padding: 0, justifyContent: 'center' }}
                    aria-label="Убрать фото"
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {err && <div className="alert error" role="alert">{err}</div>}
        <button className="btn lg block" type="submit" disabled={busy}>{busy ? 'Публикуем…' : 'Опубликовать лот'}</button>
      </form>
    </div>
  );
}
