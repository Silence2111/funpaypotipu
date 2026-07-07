'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Game { id: string; slug: string; title: string }
interface Category { id: string; slug: string; title: string; fulfillmentType: string }

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

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    apiFetch<Game[]>('/catalog/games').then(setGames).catch(() => {});
  }, [router]);

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
        if (!res.ok) continue;
        const { key } = (await res.json()) as { key: string };
        setImages((prev) => [...prev, { key, url: URL.createObjectURL(f) }]);
      } catch {
        /* пропускаем неудачные */
      }
    }
    setUploading(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const rub = parseFloat(price.replace(',', '.'));
    if (!gameId || !categoryId || !title || !description || !(rub > 0)) {
      setErr('Заполните все поля, цена больше нуля');
      return;
    }
    setBusy(true);
    try {
      const created = await apiFetch<{ id: string }>('/listings', {
        method: 'POST',
        body: JSON.stringify({
          gameId,
          categoryId,
          title,
          description,
          price: String(Math.round(rub * 100)),
          currency: 'RUB',
          images: images.map((i) => i.key),
        }),
      });
      router.push(`/lot/${created.id}`);
    } catch {
      setErr('Не удалось создать лот');
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 560, paddingTop: 48 }}>
      <h1 className="h1" style={{ fontSize: 30, marginBottom: 24 }}>Новый лот</h1>
      <form onSubmit={submit} className="stack-form">
        <select className="input" value={games.find((g) => g.id === gameId)?.slug ?? ''} onChange={(e) => onGame(e.target.value)}>
          <option value="">Выберите игру</option>
          {games.map((g) => (
            <option key={g.id} value={g.slug}>{g.title}</option>
          ))}
        </select>

        <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!categories.length}>
          <option value="">Выберите категорию</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>

        <input className="input" placeholder="Название" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" placeholder="Описание" style={{ minHeight: 120, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
        <input className="input" placeholder="Цена, ₽" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />

        <div>
          <label className="chip" style={{ cursor: 'pointer' }}>
            {uploading ? 'Загрузка…' : '+ Добавить фото'}
            <input type="file" accept="image/*" multiple onChange={onImages} style={{ display: 'none' }} />
          </label>
          {images.length > 0 && (
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {images.map((im, i) => (
                <span key={i} style={{ position: 'relative' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 999, border: 'none', background: '#ff3b30', color: '#fff', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}
                    aria-label="Удалить"
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {err && <p style={{ color: '#d33', fontSize: 14, margin: 0 }}>{err}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Публикуем…' : 'Опубликовать лот'}</button>
      </form>
    </div>
  );
}
