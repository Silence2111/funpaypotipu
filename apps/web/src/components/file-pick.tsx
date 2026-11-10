'use client';

import { useState } from 'react';
import { FileText, ImagePlus, X } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

/**
 * Выбор фото документа и селфи с превью — для проверки личности и для
 * документов к заявке «Не могу войти». Больше MAX_BYTES не загрузится в
 * хранилище.
 */
export const MAX_BYTES = 15 * 1024 * 1024;
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

/** HEIC с iPhone браузер иногда отдаёт без типа — определяем по имени. */
export function typed(file: File): File {
  if (file.type) return file;
  const type = /\.heic$/i.test(file.name)
    ? 'image/heic'
    : /\.pdf$/i.test(file.name)
      ? 'application/pdf'
      : '';
  return type ? new File([file], file.name, { type }) : file;
}

export interface Picked {
  file: File;
  preview: string | null;
}

/** Выбор файлов с превью: фото — миниатюрой, PDF — значком с именем. */
export function FilePick({
  id,
  label,
  hint,
  max,
  files,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  max: number;
  files: Picked[];
  onChange: (next: Picked[]) => void;
}) {
  const t = useT();
  const [err, setErr] = useState<string | null>(null);
  function add(list: FileList | null) {
    setErr(null);
    const picked: Picked[] = [];
    for (const raw of Array.from(list ?? []).slice(0, max - files.length)) {
      const file = typed(raw);
      if (!ACCEPT.split(',').includes(file.type)) {
        setErr(t('Подойдёт фото (JPG, PNG, WebP, HEIC) или PDF'));
        continue;
      }
      if (file.size > MAX_BYTES) {
        setErr(t('Файл больше 15 МБ — сфотографируйте заново или сожмите'));
        continue;
      }
      picked.push({
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }
    onChange([...files, ...picked]);
  }
  return (
    <div className="field">
      <span className="label" id={`${id}-label`}>
        {label}
      </span>
      <p className="hint" style={{ margin: '0 0 6px' }}>
        {hint}
      </p>
      {files.length > 0 && (
        <div className="photo-grid">
          {files.map((p, i) => (
            <div key={`${p.file.name}-${i}`} className="photo-item">
              {p.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.preview} alt="" />
              ) : (
                <span className="kyc-file-doc">
                  <FileText size={22} strokeWidth={1.75} aria-hidden />
                  <span>{p.file.name}</span>
                </span>
              )}
              <button
                type="button"
                className="photo-btn photo-remove"
                aria-label={t('Убрать файл')}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>
      )}
      {files.length < max && (
        <label className="btn secondary photo-add" aria-labelledby={`${id}-label`}>
          <ImagePlus size={18} strokeWidth={1.75} aria-hidden />
          {files.length ? t('Добавить ещё') : t('Выбрать фото или PDF')}
          <input
            id={id}
            type="file"
            accept={ACCEPT}
            multiple={max > 1}
            hidden
            onChange={(e) => {
              add(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      )}
      {err && (
        <p className="field-error" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
