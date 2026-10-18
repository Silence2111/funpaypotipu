'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, FileText, ImagePlus, ShieldCheck, X } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { uploadViaPresignedUrl } from '@/lib/upload';
import { formatPrice } from '@/lib/format';
import { CabinetNav } from '@/components/cabinet-nav';

interface Kyc {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  reason?: string | null;
  createdAt?: string;
  reviewedAt?: string | null;
}

/** Больше — не загрузится в хранилище. */
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

const when = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/** HEIC с iPhone браузер иногда отдаёт без типа — определяем по имени. */
function typed(file: File): File {
  if (file.type) return file;
  const type = /\.heic$/i.test(file.name)
    ? 'image/heic'
    : /\.pdf$/i.test(file.name)
      ? 'application/pdf'
      : '';
  return type ? new File([file], file.name, { type }) : file;
}

interface Picked {
  file: File;
  preview: string | null;
}

/** Выбор файлов с превью: фото — миниатюрой, PDF — значком с именем. */
function FilePick({
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
  const [err, setErr] = useState<string | null>(null);
  function add(list: FileList | null) {
    setErr(null);
    const picked: Picked[] = [];
    for (const raw of Array.from(list ?? []).slice(0, max - files.length)) {
      const file = typed(raw);
      if (!ACCEPT.split(',').includes(file.type)) {
        setErr('Подойдёт фото (JPG, PNG, WebP, HEIC) или PDF');
        continue;
      }
      if (file.size > MAX_BYTES) {
        setErr('Файл больше 15 МБ — сфотографируйте заново или сожмите');
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
                aria-label="Убрать файл"
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
          {files.length ? 'Добавить ещё' : 'Выбрать фото или PDF'}
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

/**
 * Проверка личности продавца: фото документа и селфи с ним. Раньше API для
 * неё был, а страницы не было: вывод больше порога шёл только через
 * поддержку, а ошибка вывода отсылала в несуществующий раздел.
 */
export default function VerificationPage() {
  const router = useRouter();
  const [kyc, setKyc] = useState<Kyc | null>(null);
  const [kycAbove, setKycAbove] = useState<string | null>(null);
  const [doc, setDoc] = useState<Picked[]>([]);
  const [selfie, setSelfie] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setKyc(await apiFetch<Kyc>('/kyc/me'));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/verification');
      return;
    }
    load().catch(() => setErr('Не удалось загрузить статус проверки'));
    apiFetch<{ payoutKycAboveMinor?: string }>('/fees/public')
      .then((p) => setKycAbove(p.payoutKycAboveMinor ?? null))
      .catch(() => {});
  }, [router, load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!doc.length || !selfie.length) {
      setErr('Нужны фото документа и селфи с ним');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const all = [...doc, ...selfie];
      const keys: string[] = [];
      for (const [i, p] of all.entries()) {
        setProgress(`${i + 1} из ${all.length}`);
        keys.push((await uploadViaPresignedUrl('/kyc/uploads', p.file)).key);
      }
      setProgress(null);
      setKyc(
        await apiFetch<Kyc>('/kyc', {
          method: 'POST',
          body: JSON.stringify({
            documentKeys: keys.slice(0, doc.length),
            selfieKey: keys[doc.length],
          }),
        }),
      );
      setDoc([]);
      setSelfie([]);
    } catch (e2) {
      setErr(apiErrorMessage(e2, 'Не удалось отправить документы. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const limit = kycAbove ? formatPrice(kycAbove) : '15 000 ₽';
  const canSend = kyc && (kyc.status === 'none' || kyc.status === 'rejected');

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          Проверка личности
        </h1>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      <section className="card" style={{ padding: 24, maxWidth: 600 }}>
        {kyc === null ? (
          <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
        ) : kyc.status === 'approved' ? (
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <ShieldCheck size={22} strokeWidth={1.75} color="var(--success)" aria-hidden />
            <div>
              <p style={{ margin: 0, fontWeight: 700 }}>Документы проверены</p>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 15 }}>
                {when(kyc.reviewedAt)}. Вывод — без ограничения суммы, в профиле и на ваших лотах —
                «Документы проверены».
              </p>
            </div>
          </div>
        ) : kyc.status === 'pending' ? (
          <div role="status">
            <p style={{ margin: 0, fontWeight: 700 }}>Документы на проверке</p>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 15 }}>
              Отправлены {when(kyc.createdAt)}. Решение придёт уведомлением.
            </p>
          </div>
        ) : (
          <>
            {kyc.status === 'rejected' && (
              <div className="alert error" role="alert" style={{ marginBottom: 16 }}>
                Документы не приняты{kyc.reason ? `: ${kyc.reason}` : ''}. Загрузите их заново.
              </div>
            )}
            <h2 className="h2" style={{ fontSize: 18, margin: 0 }}>
              Что даёт проверка
            </h2>
            <ul className="kyc-perks">
              <li>
                <Check size={16} strokeWidth={1.75} aria-hidden /> Вывод без ограничения суммы — без
                проверки за раз можно вывести до {limit}
              </li>
              <li>
                <Check size={16} strokeWidth={1.75} aria-hidden /> «Документы проверены» в профиле и
                в карточке продавца на ваших лотах
              </li>
              <li>
                <Check size={16} strokeWidth={1.75} aria-hidden /> Уровень Pro — когда хватит продаж
                и оценок
              </li>
            </ul>
          </>
        )}
      </section>

      {canSend && (
        <form
          onSubmit={submit}
          className="card stack-form"
          style={{ padding: 24, maxWidth: 600, gap: 18 }}
          noValidate
        >
          <FilePick
            id="kyc-doc"
            label="Документ"
            hint="Паспорт или другой документ с фото: разворот с фотографией целиком, без бликов. Можно добавить второе фото."
            max={2}
            files={doc}
            onChange={setDoc}
          />
          <FilePick
            id="kyc-selfie"
            label="Селфи с документом"
            hint="Лицо и раскрытый документ в одном кадре — так видно, что документ ваш."
            max={1}
            files={selfie}
            onChange={setSelfie}
          />
          <p className="hint" style={{ margin: 0 }}>
            Фото или PDF до 15 МБ. Документы видит только сотрудник проверки — другим пользователям
            они недоступны.
          </p>
          {err && (
            <div className="alert error" role="alert">
              {err}
            </div>
          )}
          <div>
            <button className="btn" type="submit" disabled={busy || !doc.length || !selfie.length}>
              {busy ? `Отправляем${progress ? ` ${progress}` : ''}…` : 'Отправить на проверку'}
            </button>
          </div>
        </form>
      )}
      {!canSend && err && (
        <div className="alert error" role="alert" style={{ maxWidth: 600 }}>
          {err}
        </div>
      )}
    </div>
  );
}
