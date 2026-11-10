'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { IMPORT_MAX_FILE_ROWS, importTemplate, type ImportAttr } from '@gamemarket/shared/lot-import';
import type { GameIndexEntry } from '@/lib/api';
import { apiFetch } from '@/lib/session';
import { useT } from '@/lib/i18n/client';

interface Section {
  id: string;
  slug: string;
  title: string;
  fulfillmentType: string;
  unitName?: string | null;
}

/** Из таблицы — лоты целиком с ручной выдачей: у ключей склад, у валюты пачка. */
const importable = (c: Section) => c.fulfillmentType === 'manual' && !c.unitName;

/**
 * «Перенести лоты за 10 минут» (часть 117): продавец с другой площадки
 * выбирает раздел, скачивает шаблон с двумя строками-примерами и
 * загружает таблицу — до 1 000 лотов разом, без входа шаблон тоже
 * скачивается.
 */
export function MoveLots({ games, initialGame }: { games: GameIndexEntry[]; initialGame: string }) {
  const t = useT();
  const [gameSlug, setGameSlug] = useState(initialGame);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState('');
  const [busy, setBusy] = useState(false);
  const game = games.find((g) => g.slug === gameSlug);
  const section = sections.find((s) => s.id === sectionId);

  useEffect(() => {
    let live = true;
    setSections([]);
    setSectionId('');
    apiFetch<{ categories: Section[] }>(`/catalog/games/${gameSlug}`)
      .then((g) => {
        if (!live) return;
        const list = g.categories.filter(importable);
        setSections(list);
        setSectionId(list[0]?.id ?? '');
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [gameSlug]);

  async function download() {
    if (!game || !section) return;
    setBusy(true);
    try {
      const attrs = await apiFetch<ImportAttr[]>(`/catalog/categories/${section.id}/attributes`).catch(() => []);
      const csv = importTemplate(attrs, t.lang, { what: `${t.d(section.title)} ${t.d(game.title)}` });
      // BOM — чтобы Excel открыл кириллицу без вопросов о кодировке.
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `gamemarket-${game.slug}-${section.slug}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  }

  const upload = section
    ? `/cabinet/lots/import?game=${encodeURIComponent(gameSlug)}&category=${encodeURIComponent(section.slug)}`
    : '/cabinet/lots/import';

  return (
    <section className="card move-lots" aria-labelledby="move-lots">
      <h2 className="h2" id="move-lots" style={{ fontSize: 22, margin: 0 }}>
        {t('Уже продаёте на другой площадке? Перенесите лоты за 10 минут')}
      </h2>
      <ol className="move-steps">
        <li>{t('Выберите игру и раздел и скачайте шаблон — в нём столбцы раздела и две строки-примера.')}</li>
        <li>
          {t(
            'Откройте его в Excel или Google Таблицах и вставьте свои лоты: название, описание, цену, наличие и параметры. Строки-примеры удалите — как есть они не выставятся.',
          )}
        </li>
        <li>
          {t(
            'Загрузите таблицу — до {n} лотов разом. Строки с ошибками сайт покажет до загрузки, остальные выставятся сразу.',
            { n: IMPORT_MAX_FILE_ROWS.toLocaleString(t.locale) },
          )}
        </li>
      </ol>
      <div className="move-pickers">
        <select
          className="input"
          aria-label={t('Игра')}
          value={gameSlug}
          onChange={(e) => setGameSlug(e.target.value)}
        >
          {[...games]
            .sort((a, b) => t.d(a.title).localeCompare(t.d(b.title), t.locale))
            .map((g) => (
              <option key={g.id} value={g.slug}>
                {t.d(g.title)}
              </option>
            ))}
        </select>
        <select
          className="input"
          aria-label={t('Раздел')}
          value={sectionId}
          disabled={!sections.length}
          onChange={(e) => setSectionId(e.target.value)}
        >
          {sections.length ? (
            sections.map((s) => (
              <option key={s.id} value={s.id}>
                {t.d(s.title)}
              </option>
            ))
          ) : (
            <option value="">{t('Таблицей — только разделы с ручной выдачей')}</option>
          )}
        </select>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn secondary" disabled={!section || busy} onClick={() => void download()}>
          <Download size={16} strokeWidth={1.75} aria-hidden /> {t('Скачать шаблон')}
        </button>
        <Link href={upload} className="btn">
          {t('Загрузить таблицу')}
        </Link>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {t('Ключи, пополнения и валюта выставляются по одному — через форму лота: у них склад или пачка.')}
      </p>
    </section>
  );
}
