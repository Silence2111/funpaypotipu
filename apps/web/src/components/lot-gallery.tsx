'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

/** Лента фото: листается пальцем и стрелками, текущий кадр — по прокрутке. */
function useTrack(count: number, start = 0) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);
  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const next = Math.max(0, Math.min(count - 1, i));
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
  };
  const onScroll = () => {
    const el = track.current;
    if (el) setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  };
  return { track, index, go, onScroll };
}

/**
 * Фото лота, как у Playerok: большое фото листается пальцем, под ним —
 * миниатюры, нажатие открывает на весь экран. Раньше фото открывались по
 * одному в новой вкладке.
 */
export function LotGallery({ images, title }: { images: string[]; title: string }) {
  const t = useT();
  const { track, index, go, onScroll } = useTrack(images.length);
  const [full, setFull] = useState<number | null>(null);
  const many = images.length > 1;

  return (
    <div className="gallery">
      <div className="gallery-main">
        <div className="gallery-track" ref={track} onScroll={onScroll}>
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              className="gallery-slide"
              onClick={() => setFull(i)}
              aria-label={t('Открыть фото {n} из {total} на весь экран', {
                n: i + 1,
                total: images.length,
              })}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={i === 0 ? title : ''} loading={i === 0 ? 'eager' : 'lazy'} />
            </button>
          ))}
        </div>
        {many && (
          <>
            <span className="gallery-count" aria-hidden>
              {index + 1} / {images.length}
            </span>
            <button
              type="button"
              className="gallery-nav prev"
              aria-label={t('Предыдущее фото')}
              disabled={index === 0}
              onClick={() => go(index - 1)}
            >
              <ChevronLeft size={20} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="gallery-nav next"
              aria-label={t('Следующее фото')}
              disabled={index === images.length - 1}
              onClick={() => go(index + 1)}
            >
              <ChevronRight size={20} strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>
      {many && (
        <div className="gallery-thumbs" role="tablist" aria-label={t('Фото лота')}>
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={t('Фото {n}', { n: i + 1 })}
              onClick={() => go(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {full !== null && <Lightbox images={images} start={full} onClose={() => setFull(null)} />}
    </div>
  );
}

/** Фото на весь экран: листать пальцем или стрелками, Esc и крестик — закрыть. */
function Lightbox({
  images,
  start,
  onClose,
}: {
  images: string[];
  start: number;
  onClose: () => void;
}) {
  const t = useT();
  const { track, index, go, onScroll } = useTrack(images.length, start);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = track.current;
    if (el) el.scrollLeft = start * el.clientWidth;
    close.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [start, track]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === 'ArrowRight') go(index + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, go, onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={t('Фото лота')}>
      <div className="lightbox-bar">
        <span>
          {index + 1} / {images.length}
        </span>
        <button
          ref={close}
          type="button"
          className="lightbox-close"
          aria-label={t('Закрыть')}
          onClick={onClose}
        >
          <X size={22} strokeWidth={1.75} />
        </button>
      </div>
      <div className="lightbox-track" ref={track} onScroll={onScroll}>
        {images.map((src) => (
          <div key={src} className="lightbox-slide">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <>
          <button
            type="button"
            className="lightbox-nav prev"
            aria-label={t('Предыдущее фото')}
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <ChevronLeft size={28} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="lightbox-nav next"
            aria-label={t('Следующее фото')}
            disabled={index === images.length - 1}
            onClick={() => go(index + 1)}
          >
            <ChevronRight size={28} strokeWidth={1.75} />
          </button>
        </>
      )}
    </div>
  );
}
