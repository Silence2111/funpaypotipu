'use client';

import { useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { apiErrorMessage } from '@/lib/errors';
import { uploadPhoto } from '@/lib/photo';
import { useT } from '@/lib/i18n/client';
import { Lightbox } from './lot-gallery';

/** Сколько фото можно приложить к отзыву — как проверяет API. */
export const MAX_REVIEW_PHOTOS = 5;

export interface ReviewPhoto {
  key: string;
  url: string;
}

/** Фото к отзыву миниатюрами; нажатие открывает на весь экран. */
export function ReviewPhotos({ images }: { images: string[] }) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  if (!images.length) return null;
  return (
    <div className="review-photos">
      {images.map((src, i) => (
        <button
          key={src}
          type="button"
          className="review-photo"
          onClick={() => setOpen(i)}
          aria-label={t('Фото к отзыву {n} из {total}', { n: i + 1, total: images.length })}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" loading="lazy" />
        </button>
      ))}
      {open !== null && (
        <Lightbox
          images={images}
          start={open}
          onClose={() => setOpen(null)}
          label={t('Фото к отзыву')}
        />
      )}
    </div>
  );
}

/**
 * Фото в форме отзыва: скриншот товара, переписки в игре. Уменьшаются на
 * телефоне перед загрузкой; уже загруженные можно убрать.
 */
export function ReviewPhotoPicker({
  value,
  onChange,
}: {
  value: ReviewPhoto[];
  onChange: (next: ReviewPhoto[] | ((prev: ReviewPhoto[]) => ReviewPhoto[])) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const left = MAX_REVIEW_PHOTOS - value.length;

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, left);
    e.target.value = '';
    setErr(null);
    setBusy(true);
    for (const f of files) {
      try {
        const { key, blob } = await uploadPhoto('/reviews/uploads', f, t.lang);
        onChange((prev) => [...prev, { key, url: URL.createObjectURL(blob) }]);
      } catch (er) {
        setErr(apiErrorMessage(er, t('Фото не загрузилось. Попробуйте другое.')));
      }
    }
    setBusy(false);
  }

  return (
    <div className="review-photo-picker">
      <div className="review-photos">
        {value.map((p) => (
          <div key={p.key} className="review-photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" />
            <button
              type="button"
              className="photo-btn photo-remove"
              aria-label={t('Убрать фото')}
              onClick={() => onChange(value.filter((x) => x.key !== p.key))}
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        ))}
        {left > 0 && (
          <label className="review-photo review-photo-add" aria-disabled={busy}>
            <ImagePlus size={20} strokeWidth={1.75} aria-hidden />
            <span>{busy ? t('Загрузка…') : t('Фото')}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              disabled={busy}
              onChange={onFiles}
              style={{ display: 'none' }}
            />
          </label>
        )}
      </div>
      <p className="hint">
        {t('До {n} фото — скриншоты товара или игры. Все покупатели их увидят.', {
          n: MAX_REVIEW_PHOTOS,
        })}
      </p>
      {err && <p className="field-error">{err}</p>}
    </div>
  );
}
