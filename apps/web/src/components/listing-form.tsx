'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ImagePlus, Star, X } from 'lucide-react';
import { markupLabel, topupQuote, topupTermsError } from '@gamemarket/shared/topup';
import {
  PRICE_PER_UNITS,
  QTY_TIER_MAX_PCT,
  QTY_TIERS_MAX,
  qtyPrice,
  qtyTermsError,
  qtyTiersError,
} from '@gamemarket/shared/quantity';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice, formatQty } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { shrink } from '@/lib/photo';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface Game { id: string; slug: string; title: string }
interface Category {
  id: string;
  slug: string;
  title: string;
  fulfillmentType: string;
  /** Общая пачка раздела валюты: все продают «за 1 000 золота». */
  unitName?: string | null;
  pricePerUnits?: number | null;
}
interface Attr { key: string; label: string; type: string; options?: string[] | null; isRequired: boolean }

/** Свой лот для формы изменения — ответ `GET /listings/mine/:id`. */
export interface EditableListing {
  id: string;
  status: string;
  gameId: string;
  categoryId: string;
  title: string;
  description: string;
  price: string;
  attributes: Record<string, unknown>;
  images: string[];
  imageKeys: string[];
  topupMarkupBps: number | null;
  topupMin: string | null;
  topupMax: string | null;
  unitName: string | null;
  pricePerUnits: number;
  minQty: number;
  stock: number | null;
  qtyDiscounts?: Array<{ from: number; pct: number }> | null;
  buyerFields: Array<{ label: string; required: boolean }> | null;
  /** auto_key — выдаётся со склада: ключи или строки товара. */
  fulfillmentType: string;
  deliveryTemplate: string | null;
  game: { slug: string; title: string };
  category: { slug: string; title: string; fulfillmentType: string; unitName?: string | null; pricePerUnits?: number | null };
}

const rubOf = (minor: string | null | undefined) => (minor ? String(Number(BigInt(minor)) / 100) : '');

/** Целое из поля ввода: «250 000» → 250000; пусто или не число — NaN. */
const intOf = (v: string) => {
  const t = v.replace(/[\s\u00a0\u202f]/g, '');
  return /^\d+$/.test(t) ? Number(t) : NaN;
};

const MAX_PHOTOS = 12;

/**
 * Форма лота: новый лот или изменение своего. Одна форма на оба случая —
 * иначе правила (характеристики, пополнение на сумму, превью «вы получите»)
 * разъедутся между созданием и правкой при первом же изменении.
 *
 * При изменении игра и раздел не меняются: от раздела зависят характеристики
 * и способ выдачи, а заказы и отзывы уже привязаны к лоту.
 */
export function ListingForm({
  initial,
  copyOf,
  preset,
}: {
  initial?: EditableListing;
  /**
   * «Копировать»: новый лот с условиями своего лота. Это создание, а не
   * правка: исходный лот не меняется, склад ключей и строк не копируется.
   */
  copyOf?: EditableListing;
  /** «Продать в разделе»: игра и раздел (слаги) уже выбраны. */
  preset?: { game: string; category?: string };
}) {
  const t = useT();
  const router = useRouter();
  const editing = !!initial;
  // Откуда берутся значения полей: правка — сам лот, копия — исходный лот.
  const base = initial ?? copyOf;
  const [games, setGames] = useState<Game[]>(
    base ? [{ id: base.gameId, slug: base.game.slug, title: base.game.title }] : [],
  );
  const [categories, setCategories] = useState<Category[]>(
    base ? [{ id: base.categoryId, ...base.category }] : [],
  );
  const [gameId, setGameId] = useState(base?.gameId ?? '');
  const [categoryId, setCategoryId] = useState(base?.categoryId ?? '');
  const [title, setTitle] = useState(base?.title ?? '');
  const [description, setDescription] = useState(base?.description ?? '');
  const [price, setPrice] = useState(base && base.topupMarkupBps == null ? rubOf(base.price) : '');
  const [images, setImages] = useState<{ key: string; url: string }[]>(
    base ? base.imageKeys.map((key, i) => ({ key, url: base.images[i] ?? key })) : [],
  );
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<{ feeSeller: string; sellerPayout: string; level: { label: string } | null } | null>(null);
  const [attrs, setAttrs] = useState<Attr[]>([]);
  const [attrValues, setAttrValues] = useState<Record<string, string | boolean>>(() => {
    const out: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(base?.attributes ?? {})) {
      if (typeof v === 'boolean' || typeof v === 'string') out[k] = v;
      else if (v != null) out[k] = String(v);
    }
    return out;
  });
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  // Ошибки у конкретных полей, показываются после ухода из поля или отправки
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (k: string) => setTouched((prev) => ({ ...prev, [k]: true }));
  // Пополнение на сумму покупателя: продавец задаёт наценку и границы, а не цену.
  const [byAmount, setByAmount] = useState(base?.topupMarkupBps != null);
  const [markup, setMarkup] = useState(
    base?.topupMarkupBps != null ? String(base.topupMarkupBps / 100) : '',
  );
  const [minRub, setMinRub] = useState(base?.topupMin ? rubOf(base.topupMin) : '100');
  const [maxRub, setMaxRub] = useState(base?.topupMax ? rubOf(base.topupMax) : '15000');
  // Поштучно, как валюта на FunPay: цена за пачку единиц, наличие, минимум.
  const [byQty, setByQty] = useState(base?.unitName != null);
  const [unitName, setUnitName] = useState(base?.unitName ?? '');
  const [perUnits, setPerUnits] = useState<number>(base?.pricePerUnits ?? 1);
  const [minQty, setMinQty] = useState(base ? String(base.minQty) : '1');
  // Копия распроданного лота — наличие пустое: с нулём она сразу ушла бы в «закончился».
  const [stock, setStock] = useState(
    base?.unitName != null && base.stock != null && !(copyOf && base.stock === 0) ? String(base.stock) : '',
  );
  // Скидка за количество: «от 10 000 — 5%», до трёх ступеней.
  const [tiers, setTiers] = useState<Array<{ from: string; pct: string }>>(
    () => base?.qtyDiscounts?.map((x) => ({ from: String(x.from), pct: String(x.pct) })) ?? [],
  );
  // Что спросить у покупателя до оплаты: ник, сервер — как поля лота на Playerok.
  const [buyerFields, setBuyerFields] = useState<Array<{ label: string; required: boolean }>>(base?.buyerFields ?? []);
  // Автовыдача со склада строк у аккаунтов и предметов, как боты на FunPay.
  const [autoDelivery, setAutoDelivery] = useState(base?.fulfillmentType === 'auto_key');
  // Сообщение покупателю в чат заказа сразу после оплаты.
  const [template, setTemplate] = useState(base?.deliveryTemplate ?? '');

  // Копия — как «Продать в разделе»: подгружаются все разделы её игры.
  const presetGame = preset?.game ?? copyOf?.game.slug;
  const presetCategory = preset?.category ?? copyOf?.category.slug;
  useEffect(() => {
    if (editing) return; // страница изменения сама проверяет вход и грузит лот
    if (!getToken()) {
      const p = new URLSearchParams();
      if (presetGame) p.set('game', presetGame);
      if (presetCategory) p.set('category', presetCategory);
      const qs = p.toString();
      const here = qs ? `/cabinet/new?${qs}` : '/cabinet/new';
      router.replace(`/register?next=${encodeURIComponent(here)}&seller=1`);
      return;
    }
    apiFetch<Game[]>('/catalog/games')
      .then(async (list) => {
        setGames(list);
        const g = presetGame ? list.find((x) => x.slug === presetGame) : undefined;
        if (!g) return;
        setGameId(g.id);
        const full = await apiFetch<Game & { categories: Category[] }>(`/catalog/games/${g.slug}`);
        setCategories(full.categories);
        const c = full.categories.find((x) => x.slug === presetCategory);
        if (c) setCategoryId(c.id);
      })
      .catch(() => {});
  }, [router, editing, presetGame, presetCategory]);

  const selected = categories.find((c) => c.id === categoryId);
  // Раздел валюты с общей пачкой: продают только количеством и только «за
  // 1 000 золота» — иначе цены в разделе несравнимы. Единицу и пачку задаёт
  // раздел, продавец указывает цену, наличие и минимум.
  const pack =
    selected?.fulfillmentType === 'manual' && selected.unitName && selected.pricePerUnits
      ? { unitName: selected.unitName, pricePerUnits: selected.pricePerUnits }
      : null;
  useEffect(() => {
    if (!pack) return;
    setByQty(true);
    setUnitName(pack.unitName);
    setPerUnits(pack.pricePerUnits);
  }, [pack?.unitName, pack?.pricePerUnits]); // eslint-disable-line react-hooks/exhaustive-deps
  const variable = byAmount && selected?.fulfillmentType === 'provider';
  // Склад строк — у аккаунтов, предметов и услуг; валюту продают количеством.
  const canAuto = selected?.fulfillmentType === 'manual' && !pack;
  const autoLines = canAuto && autoDelivery;
  const manualLot = selected?.fulfillmentType === 'manual' && !autoLines;
  const perPiece = byQty && manualLot;
  // Пополнение выполняет провайдер — инструкция продавца там ни к чему.
  const withNote = !!selected && selected.fulfillmentType !== 'provider';
  const qtyTerms = {
    unitName: unitName.trim() || null,
    pricePerUnits: perUnits,
    minQty: intOf(minQty),
    stock: stock.trim() ? intOf(stock) : null,
  };
  const unitLabel = (n: number) => formatQty(n, unitName.trim() || t('ед.'), t);
  const cleanTiers = tiers
    .map((x) => ({ from: intOf(x.from), pct: intOf(x.pct) }))
    .sort((a, b) => a.from - b.from);
  // «7,5%» по-английски — «7.5%».
  const pct = (bps: number) => (t.lang === 'en' ? markupLabel(bps).replace(',', '.') : markupLabel(bps));
  const markupPct = parseFloat(markup.replace(',', '.'));
  const terms =
    /^\d{1,6}$/.test(minRub) && /^\d{1,6}$/.test(maxRub) && Number.isFinite(markupPct)
      ? { markupBps: Math.round(markupPct * 100), min: BigInt(minRub) * 100n, max: BigInt(maxRub) * 100n }
      : null;
  const termsError = terms ? topupTermsError(terms) : t('Укажите наценку и границы суммы целыми рублями');
  // Превью считаем на понятном примере — 1 000 ₽, если он в границах, иначе на минимуме.
  const example =
    terms && !termsError
      ? topupQuote(terms.min <= 100_000n && terms.max >= 100_000n ? 100_000n : terms.min, terms.markupBps)
      : null;

  // Сумма для превью — число, а не объект: объект пересоздаётся каждый
  // рендер, и эффект с ним в зависимостях запрашивал бы превью по кругу.
  const previewMinor = variable
    ? example
      ? Number(example.price)
      : 0
    : Math.round(parseFloat(price.replace(',', '.')) * 100);

  // Живое превью комиссии/выплаты с учётом уровня продавца.
  useEffect(() => {
    if (!categoryId || !(previewMinor > 0)) {
      setQuote(null);
      return;
    }
    const timer = setTimeout(() => {
      const p = new URLSearchParams({ categoryId, price: String(previewMinor), currency: 'RUB' });
      apiFetch<{ feeSeller: string; sellerPayout: string; level: { label: string } | null }>(`/fees/quote?${p}`)
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [categoryId, previewMinor]);

  // Атрибуты выбранной категории (характеристики/фильтры как на FunPay).
  // Значения сбрасываются при смене раздела (onCategory), а не здесь: иначе
  // форма изменения стирала бы сохранённые характеристики при открытии.
  useEffect(() => {
    setAttrs([]);
    if (!categoryId) return;
    apiFetch<Attr[]>(`/catalog/categories/${categoryId}/attributes`)
      .then(setAttrs)
      .catch(() => setAttrs([]));
  }, [categoryId]);

  function onCategory(id: string) {
    setCategoryId(id);
    setAttrValues({});
  }

  async function onGame(slug: string) {
    const g = games.find((x) => x.slug === slug);
    setGameId(g?.id ?? '');
    onCategory('');
    if (!slug) return setCategories([]);
    const full = await apiFetch<Game & { categories: Category[] }>(`/catalog/games/${slug}`);
    setCategories(full.categories);
  }

  async function onImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS - images.length);
    e.target.value = '';
    setUploadErr(null);
    setUploading(true);
    const token = getToken();
    for (const [i, f] of files.entries()) {
      setProgress(files.length > 1 ? t('{i} из {n}', { i: i + 1, n: files.length }) : null);
      try {
        const body = await shrink(f);
        const fd = new FormData();
        fd.append('file', body, body === f ? f.name : 'photo.webp');
        const res = await fetch(`${API_URL}/api/listings/uploads`, {
          method: 'POST',
          // Причина отказа — на языке сайта.
          headers: { 'Accept-Language': t.lang, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: fd,
        });
        if (!res.ok) {
          // Причину говорит сервер: «больше 8 МБ», «только изображения».
          setUploadErr(apiErrorMessage(new Error(await res.text()), t('Фото не загрузилось. Попробуйте другое.')));
          continue;
        }
        const { key } = (await res.json()) as { key: string };
        setImages((prev) => [...prev, { key, url: URL.createObjectURL(body) }]);
      } catch (er) {
        setUploadErr(apiErrorMessage(er, t('Фото не загрузилось. Проверьте связь и попробуйте ещё раз.')));
      }
    }
    setUploading(false);
    setProgress(null);
  }

  const rubValue = parseFloat(price.replace(',', '.').replace(/\s/g, ''));
  // Проверки общих модулей (пополнение, количество) — русской строкой; t.d переводит.
  const qtyError = perPiece ? qtyTermsError(qtyTerms) : null;
  const tiersError = perPiece && cleanTiers.length ? qtyTiersError(cleanTiers, intOf(minQty)) : null;
  // Пример для продавца — на верхней ступени: «10 000 золота — 1 425 ₽ вместо 1 500 ₽».
  const top = cleanTiers.at(-1);
  const tierExample =
    perPiece && top && !tiersError && !qtyError && rubValue > 0
      ? qtyPrice(BigInt(Math.round(rubValue * 100)), perUnits, top.from, cleanTiers)
      : null;
  const fieldErrors: Record<string, string | null> = {
    game: gameId ? null : t('Выберите игру'),
    category: categoryId ? null : t('Выберите, что продаёте'),
    title: title.trim().length >= 3 ? null : t('Название — от 3 знаков: его видят в каталоге'),
    description: description.trim() ? null : t('Опишите, что получит покупатель и как передаёте'),
    price: variable ? null : rubValue > 0 ? null : t('Цена в рублях, например 490'),
    topup: variable && termsError ? t.d(termsError) : null,
    qty: qtyError ? t.d(qtyError) : null,
    tiers: tiersError ? t.d(tiersError) : null,
    buyer:
      !manualLot
        ? null
        : buyerFields.some((f) => f.label.trim().length < 2)
          ? t('Название поля — от 2 символов')
          : new Set(buyerFields.map((f) => f.label.trim().toLowerCase())).size !== buyerFields.length
            ? t('Названия полей не должны повторяться')
            : null,
  };
  const cleanTemplate = template.trim();
  const cleanFields = buyerFields.map((f) => ({ label: f.label.trim(), required: f.required }));
  const showErr = (k: string) => (touched[k] ? fieldErrors[k] : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setTouched({ game: true, category: true, title: true, description: true, price: true, topup: true, qty: true, tiers: true, buyer: true });
    if (Object.values(fieldErrors).some(Boolean)) {
      setErr(
        editing
          ? t('Изменения не сохранены — поправьте отмеченные поля.')
          : t('Лот не опубликован — поправьте отмеченные поля.'),
      );
      return;
    }
    const missing = attrs.find((a) => a.isRequired && !attrValues[a.key]);
    if (missing) {
      setErr(t('Укажите характеристику «{name}»', { name: t.d(missing.label) }));
      return;
    }
    const cleanAttrs: Record<string, string | boolean> = {};
    for (const a of attrs) {
      const v = attrValues[a.key];
      if (v !== undefined && v !== '' && v !== false) cleanAttrs[a.key] = v;
    }
    setBusy(true);
    if (initial) {
      try {
        // Цену лота «на сумму покупателя» сервер считает из условий сам; при
        // переходе обратно на фиксированную цену условия снимаются (topup: null).
        const pricing =
          variable && terms
            ? { topup: { markupBps: terms.markupBps, min: terms.min.toString(), max: terms.max.toString() } }
            : {
                price: String(Math.round(rubValue * 100)),
                ...(initial.topupMarkupBps != null ? { topup: null } : {}),
              };
        // Поштучно → целиком: единица и наличие снимаются вместе.
        const quantity = perPiece
          ? { ...qtyTerms, qtyDiscounts: cleanTiers.length ? cleanTiers : null }
          : initial.unitName != null && initial.category.fulfillmentType === 'manual'
            ? { unitName: null, stock: null }
            : {};
        const saved = await apiFetch<{ status: string }>(`/listings/${initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            attributes: cleanAttrs,
            images: images.map((i) => i.key),
            ...pricing,
            ...quantity,
            // Поля спрашиваются только у ручной выдачи; пустой список их снимает.
            ...(manualLot ? { buyerFields: cleanFields.length ? cleanFields : null } : {}),
            ...(canAuto ? { autoDelivery: autoLines } : {}),
            ...(withNote ? { deliveryTemplate: cleanTemplate || null } : {}),
          }),
        });
        // Только что включили автовыдачу, а склад пуст — сразу к складу на странице лота.
        const switchedOn = autoLines && initial.fulfillmentType !== 'auto_key';
        router.push(
          switchedOn && saved.status === 'sold_out'
            ? `/lot/${initial.id}?stock=1`
            : initial.status === 'active'
              ? `/lot/${initial.id}?updated=1`
              : '/cabinet/lots?updated=1',
        );
      } catch (e) {
        setErr(apiErrorMessage(e, t('Не удалось сохранить изменения. Попробуйте ещё раз через минуту.')));
        setBusy(false);
      }
      return;
    }
    try {
      const created = await apiFetch<{ id: string }>('/listings', {
        method: 'POST',
        body: JSON.stringify({
          gameId,
          categoryId,
          title: title.trim(),
          description: description.trim(),
          // У лота на сумму покупателя цену («от») сервер считает из условий сам.
          price: variable && terms ? topupQuote(terms.min, terms.markupBps).price.toString() : String(Math.round(rubValue * 100)),
          currency: 'RUB',
          attributes: cleanAttrs,
          images: images.map((i) => i.key),
          ...(variable && terms
            ? { topup: { markupBps: terms.markupBps, min: terms.min.toString(), max: terms.max.toString() } }
            : {}),
          ...(perPiece ? { ...qtyTerms, ...(cleanTiers.length ? { qtyDiscounts: cleanTiers } : {}) } : {}),
          ...(manualLot && cleanFields.length ? { buyerFields: cleanFields } : {}),
          ...(autoLines ? { autoDelivery: true } : {}),
          ...(withNote && cleanTemplate ? { deliveryTemplate: cleanTemplate } : {}),
        }),
      });
      router.push(`/lot/${created.id}?created=1`);
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось опубликовать лот. Попробуйте ещё раз через минуту.')));
      setBusy(false);
    }
  }

  const selectedCategory = selected;

  return (
    <div className="container" style={{ maxWidth: 600, paddingTop: 40 }}>
      <h1 className="h1" style={{ fontSize: 32 }}>
        {editing ? t('Изменить лот') : copyOf ? t('Копия лота') : t('Новый лот')}
      </h1>
      <p className="muted" style={{ margin: '8px 0 24px' }}>
        {editing
          ? t('Изменения видны в каталоге сразу. Уже оформленные заказы идут по прежней цене.')
          : copyOf
            ? `${t('Всё — как у «{title}»: поправьте, что нужно, и опубликуйте. Исходный лот не изменится.', { title: copyOf.title })}${
                copyOf.fulfillmentType === 'auto_key'
                  ? ` ${t('Товар со склада не копируется — загрузите его после публикации.')}`
                  : ''
              }`
            : t('Лот появится в каталоге сразу. Деньги за продажу придут на баланс, когда покупатель подтвердит получение.')}
      </p>
      <form onSubmit={submit} className="card stack-form" style={{ gap: 18, padding: 24 }} noValidate>
        <div className="field">
          <label className="label" htmlFor="game">{t('Игра')}</label>
          <select id="game" className="input" value={games.find((g) => g.id === gameId)?.slug ?? ''} disabled={editing}
            onChange={(e) => onGame(e.target.value)} onBlur={() => touch('game')} aria-invalid={!!showErr('game')}>
            <option value="">{t('Выберите игру')}</option>
            {games.map((g) => (
              <option key={g.id} value={g.slug}>{t.d(g.title)}</option>
            ))}
          </select>
          {showErr('game') && <p className="field-error">{showErr('game')}</p>}
        </div>

        <div className="field">
          <label className="label" htmlFor="category">{t('Что продаёте')}</label>
          <select id="category" className="input" value={categoryId} onChange={(e) => onCategory(e.target.value)}
            onBlur={() => touch('category')} disabled={editing || !categories.length} aria-invalid={!!showErr('category')}>
            <option value="">{categories.length ? t('Выберите категорию') : t('Сначала выберите игру')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{t.d(c.title)}</option>
            ))}
          </select>
          {showErr('category') ? (
            <p className="field-error">{showErr('category')}</p>
          ) : editing ? (
            <p className="hint">{t('Игру и раздел у выставленного лота не меняют: к ним привязаны характеристики и заказы.')}</p>
          ) : selectedCategory?.fulfillmentType === 'auto_key' ? (
            <p className="hint">
              {t(
                'Ключи загрузите на склад после публикации: с первым ключом лот появится в каталоге. Покупатель получит ключи сразу после оплаты, можно несколько в одном заказе.',
              )}
            </p>
          ) : null}
        </div>

        {attrs.length > 0 && (
          <div className="stack-form" style={{ gap: 14 }}>
            {attrs.map((a) => (
              <div key={a.key} className="field">
                <label className="label" htmlFor={`attr-${a.key}`}>
                  {a.isRequired ? t.d(a.label) : t('{label} — необязательно', { label: t.d(a.label) })}
                </label>
                {a.type === 'enum' && a.options ? (
                  <select id={`attr-${a.key}`} className="input" value={String(attrValues[a.key] ?? '')}
                    onChange={(e) => setAttrValues((v) => ({ ...v, [a.key]: e.target.value }))}>
                    <option value="">{t('Выберите')}</option>
                    {a.options.map((o) => <option key={o} value={o}>{t.d(o)}</option>)}
                  </select>
                ) : a.type === 'bool' ? (
                  <label className="row" style={{ gap: 8, fontSize: 14, minHeight: 44 }}>
                    <input id={`attr-${a.key}`} type="checkbox" checked={!!attrValues[a.key]}
                      style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                      onChange={(e) => setAttrValues((v) => ({ ...v, [a.key]: e.target.checked }))} /> {t('Да')}
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
          <label className="label" htmlFor="title">{t('Название')}</label>
          <input id="title" className="input" placeholder={t('Например, Аккаунт CS2, Prime, 800 часов')} value={title} maxLength={120}
            onChange={(e) => setTitle(e.target.value)} onBlur={() => touch('title')} aria-invalid={!!showErr('title')} />
          {showErr('title') && <p className="field-error">{showErr('title')}</p>}
        </div>

        <div className="field">
          <label className="label" htmlFor="description">{t('Описание')}</label>
          <textarea id="description" className="input" style={{ minHeight: 120, resize: 'vertical' }}
            placeholder={t('Что входит, как передаёте, сколько ждать. Чем точнее — тем меньше споров.')}
            value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => touch('description')}
            aria-invalid={!!showErr('description')} />
          {showErr('description') && <p className="field-error">{showErr('description')}</p>}
        </div>

        {selectedCategory?.fulfillmentType === 'provider' && (
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 6, padding: 0 }}>{t('Как продаёте')}</legend>
            {[
              { v: false, t: t('Фиксированная цена'), d: t('Один номинал за одну цену, например «3280 кристаллов»') },
              {
                v: true,
                t: t('На сумму покупателя'),
                d: t('Покупатель вводит сумму, вы задаёте наценку и границы — как пополнение Steam'),
              },
            ].map((o) => (
              <label key={o.t} className="row" style={{ gap: 10, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' }}>
                <input type="radio" name="pricing" checked={byAmount === o.v} onChange={() => setByAmount(o.v)}
                  style={{ marginTop: 3, width: 18, height: 18, accentColor: 'var(--accent)' }} />
                <span>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{o.t}</span>
                  <span className="hint" style={{ display: 'block' }}>{o.d}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {canAuto && (
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 6, padding: 0 }}>{t('Как выдаёте')}</legend>
            {[
              { v: false, t: t('Вручную'), d: t('Передаёте товар в чате заказа и отмечаете выдачу') },
              {
                v: true,
                t: t('Автоматически со склада'),
                d: t(
                  'Загружаете товар строками: логин и пароль, промокод, ссылка. Покупатель получает свою строку сразу после оплаты',
                ),
              },
            ].map((o) => (
              <label key={o.t} className="row" style={{ gap: 10, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' }}>
                <input type="radio" name="delivery" checked={autoDelivery === o.v} onChange={() => setAutoDelivery(o.v)}
                  style={{ marginTop: 3, width: 18, height: 18, accentColor: 'var(--accent)' }} />
                <span>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{o.t}</span>
                  <span className="hint" style={{ display: 'block' }}>{o.d}</span>
                </span>
              </label>
            ))}
            {autoLines ? (
              <p className="hint" style={{ margin: '4px 0 0' }}>
                {initial?.fulfillmentType === 'auto_key' ? (
                  <>
                    {t('Склад — внизу,')}{' '}
                    <Link href={`/lot/${initial.id}#keys`} className="inline-link">
                      {t('на странице лота')}
                    </Link>
                    .
                  </>
                ) : (
                  t('Товар загрузите на склад после сохранения: с первой строкой лот появится в каталоге.')
                )}{' '}
                {t('Каждая строка — одна штука: покупатель может взять несколько, наличие считает склад.')}
              </p>
            ) : initial?.fulfillmentType === 'auto_key' ? (
              <p className="hint" style={{ margin: '4px 0 0' }}>
                {t('Строки на складе останутся: включите автовыдачу снова — и они вернутся в продажу.')}
              </p>
            ) : null}
          </fieldset>
        )}

        {manualLot && (
          <div className="field">
            <span className="label">{t('Что спросить у покупателя — необязательно')}</span>
            {buyerFields.map((f, i) => (
              <div key={i} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input className="input" style={{ flex: 1, minWidth: 160 }} maxLength={40} value={f.label}
                  aria-label={t('Поле {n}', { n: i + 1 })} placeholder={t('Например, ник в игре')} onBlur={() => touch('buyer')}
                  onChange={(e) => setBuyerFields((list) => list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <label className="row hint" style={{ gap: 6, cursor: 'pointer', minHeight: 44 }}>
                  <input type="checkbox" checked={f.required} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                    onChange={(e) => setBuyerFields((list) => list.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
                  {t('обязательно')}
                </label>
                <button type="button" className="chip" aria-label={t('Убрать поле {name}', { name: f.label || i + 1 })}
                  onClick={() => setBuyerFields((list) => list.filter((_, j) => j !== i))}>{t('Убрать')}</button>
              </div>
            ))}
            {buyerFields.length < 3 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {[t('Ник в игре'), t('Сервер'), t('ID персонажа')]
                  .filter((l) => !buyerFields.some((f) => f.label.trim().toLowerCase() === l.toLowerCase()))
                  .map((l) => (
                    <button key={l} type="button" className="chip"
                      onClick={() => setBuyerFields((list) => [...list, { label: l, required: true }])}>+ {l}</button>
                  ))}
                <button type="button" className="chip" onClick={() => setBuyerFields((list) => [...list, { label: '', required: true }])}>
                  + {t('Своё поле')}
                </button>
              </div>
            )}
            {showErr('buyer') ? (
              <p className="field-error">{showErr('buyer')}</p>
            ) : (
              <p className="hint">
                {t('Покупатель заполнит это до оплаты, ответы будут в заказе. Пароли и коды не спрашивайте.')}
              </p>
            )}
          </div>
        )}

        {withNote && (
          <div className="field">
            <label className="label" htmlFor="note">{t('Сообщение покупателю после оплаты — необязательно')}</label>
            <textarea id="note" className="input" style={{ minHeight: 96, resize: 'vertical' }} maxLength={2000}
              placeholder={
                selected?.fulfillmentType === 'auto_key'
                  ? t('Например: активируйте ключ в Steam — «Игры», затем «Активировать в Steam»')
                  : autoLines
                    ? t('Например: войдите по данным из заказа и сразу смените пароль и почту')
                    : t('Например: спасибо за заказ, передам товар за 15 минут — будьте в сети')
              }
              value={template} onChange={(e) => setTemplate(e.target.value)} />
            <p className="hint">
              {t('Придёт в чат заказа от вашего имени сразу после оплаты. Контакты и ссылки скрываются, как в любом сообщении.')}
            </p>
          </div>
        )}

        {pack && (
          <p className="hint" style={{ margin: 0 }}>
            {t(
              'В этом разделе продают количеством: цена — за {qty}, одинаково у всех продавцов, чтобы покупатель сравнивал цены.',
              { qty: formatQty(pack.pricePerUnits, pack.unitName, t) },
            )}
          </p>
        )}

        {manualLot && !pack && (
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 6, padding: 0 }}>{t('Как продаёте')}</legend>
            {[
              { v: false, t: t('Целиком'), d: t('Один товар или услуга за одну цену: аккаунт, буст, предмет') },
              {
                v: true,
                t: t('Поштучно'),
                d: t('Валюта или одинаковые предметы: цена за пачку, количество выбирает покупатель'),
              },
            ].map((o) => (
              <label key={o.t} className="row" style={{ gap: 10, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' }}>
                <input type="radio" name="selling" checked={byQty === o.v} onChange={() => setByQty(o.v)}
                  style={{ marginTop: 3, width: 18, height: 18, accentColor: 'var(--accent)' }} />
                <span>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{o.t}</span>
                  <span className="hint" style={{ display: 'block' }}>{o.d}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {perPiece && (
          <div className="field">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <div className="field">
                <label className="label" htmlFor="qty-unit">{t('Единица')}</label>
                <input id="qty-unit" className="input" placeholder={t('золота')} maxLength={24} value={unitName}
                  readOnly={!!pack} onChange={(e) => setUnitName(e.target.value)} onBlur={() => touch('qty')} />
              </div>
              <div className="field">
                <label className="label" htmlFor="qty-per">{t('Цена за')}</label>
                <select id="qty-per" className="input" value={perUnits} disabled={!!pack}
                  onChange={(e) => setPerUnits(Number(e.target.value))}>
                  {PRICE_PER_UNITS.map((n) => (
                    <option key={n} value={n}>{unitLabel(n)}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="qty-stock">{t('В наличии')}</label>
                <input id="qty-stock" className="input" inputMode="numeric" placeholder="250000" value={stock}
                  onChange={(e) => setStock(e.target.value)} onBlur={() => touch('qty')} />
              </div>
              <div className="field">
                <label className="label" htmlFor="qty-min">{t('Минимум за заказ')}</label>
                <input id="qty-min" className="input" inputMode="numeric" placeholder="1" value={minQty}
                  onChange={(e) => setMinQty(e.target.value)} onBlur={() => touch('qty')} />
              </div>
            </div>
            {showErr('qty') ? (
              <p className="field-error">{showErr('qty')}</p>
            ) : (
              <p className="hint">
                {pack ? null : <>{t('Единицу пишите так, как она стоит после числа: 1 000 золота, 5 шт.')} </>}
                {t('Наличие уменьшается с каждой оплатой; на нуле лот уходит из каталога.')}
              </p>
            )}

            <div className="field" style={{ marginTop: 16 }}>
              <span className="label">{t('Скидка за количество')}</span>
              {tiers.length > 0 && (
                <div className="qty-tiers">
                  <span className="faint qty-tiers-head">{t('От, {unit}', { unit: unitName.trim() || t('ед.') })}</span>
                  <span className="faint qty-tiers-head">{t('Скидка, %')}</span>
                  <span />
                  {tiers.map((x, i) => (
                    <div key={i} style={{ display: 'contents' }}>
                      <input className="input" inputMode="numeric" placeholder="10000" value={x.from}
                        aria-label={t('Ступень {n}: от какого количества', { n: i + 1 })}
                        onChange={(e) => setTiers((l) => l.map((y, j) => (j === i ? { ...y, from: e.target.value } : y)))}
                        onBlur={() => touch('tiers')} />
                      <input className="input" inputMode="numeric" placeholder="5" maxLength={2} value={x.pct}
                        aria-label={t('Ступень {n}: скидка, %', { n: i + 1 })}
                        onChange={(e) => setTiers((l) => l.map((y, j) => (j === i ? { ...y, pct: e.target.value.replace(/\D/g, '') } : y)))}
                        onBlur={() => touch('tiers')} />
                      <button type="button" className="icon-btn" aria-label={t('Убрать ступень {n}', { n: i + 1 })}
                        onClick={() => setTiers((l) => l.filter((_, j) => j !== i))}>
                        <X size={16} strokeWidth={1.75} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {tiers.length < QTY_TIERS_MAX && (
                <div>
                  <button type="button" className="chip" onClick={() => setTiers((l) => [...l, { from: '', pct: '' }])}>
                    {t('Добавить ступень')}
                  </button>
                </div>
              )}
              {showErr('tiers') ? (
                <p className="field-error">{showErr('tiers')}</p>
              ) : tierExample?.tier ? (
                <p className="hint">
                  {t('Например, {qty} — {sum} вместо {full}.', {
                    qty: unitLabel(tierExample.tier.from),
                    sum: formatPrice(tierExample.total.toString(), 'RUB', t),
                    full: formatPrice(tierExample.full.toString(), 'RUB', t),
                  })}
                </p>
              ) : (
                <p className="hint">
                  {t('Берут больше — платят меньше: скидка от суммы за количество, за ваш счёт, до {max}%. Необязательно.', {
                    max: QTY_TIER_MAX_PCT,
                  })}
                </p>
              )}
            </div>
          </div>
        )}

        {variable ? (
          <div className="field">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              {[
                { id: 'markup', label: t('Наценка, %'), value: markup, set: setMarkup, ph: '8', mode: 'decimal' as const },
                { id: 'min', label: t('От, ₽'), value: minRub, set: setMinRub, ph: '100', mode: 'numeric' as const },
                { id: 'max', label: t('До, ₽'), value: maxRub, set: setMaxRub, ph: '15000', mode: 'numeric' as const },
              ].map((f) => (
                <div key={f.id} className="field">
                  <label className="label" htmlFor={`topup-${f.id}`}>{f.label}</label>
                  <input id={`topup-${f.id}`} className="input" inputMode={f.mode} placeholder={f.ph} value={f.value}
                    onChange={(e) => f.set(e.target.value)} onBlur={() => touch('topup')}
                    aria-invalid={!!showErr('topup')} />
                </div>
              ))}
            </div>
            {showErr('topup') ? (
              <p className="field-error">{showErr('topup')}</p>
            ) : (
              <p className="hint">{t('Покупатель вводит сумму в этих границах и платит её плюс вашу наценку.')}</p>
            )}
          </div>
        ) : (
          <div className="field">
            <label className="label" htmlFor="price">
              {perPiece ? t('Цена за {qty}, ₽', { qty: unitLabel(perUnits) }) : t('Цена, ₽')}
            </label>
            <input id="price" className="input" placeholder="490" inputMode="decimal" value={price} style={{ maxWidth: 220 }}
              onChange={(e) => setPrice(e.target.value)} onBlur={() => touch('price')} aria-invalid={!!showErr('price')} />
            {showErr('price') && <p className="field-error">{showErr('price')}</p>}
          </div>
        )}

        {quote ? (
          <div className="card flat" style={{ padding: 16, background: 'var(--page)' }}>
            {variable && example && terms && (
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 14 }}>
                {t('Покупатель пополняет {nominal} и платит {price} с наценкой {markup}', {
                  nominal: formatPrice(example.nominal.toString(), 'RUB', t),
                  price: formatPrice(example.price.toString(), 'RUB', t),
                  markup: pct(terms.markupBps),
                })}
              </p>
            )}
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
              <span className="muted">{t('Комиссия площадки')}</span>
              <span>−{formatPrice(quote.feeSeller, 'RUB', t)}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 15, fontWeight: 700, marginTop: 6 }}>
              <span>{perPiece ? t('Вы получите за {qty}', { qty: unitLabel(perUnits) }) : t('Вы получите')}</span>
              <span style={{ color: 'var(--success)' }}>{formatPrice(quote.sellerPayout, 'RUB', t)}</span>
            </div>
            {quote.level && (
              <p className="hint" style={{ marginTop: 6 }}>
                {t('Ваш уровень: {level}', { level: t.d(quote.level.label) })}
              </p>
            )}
          </div>
        ) : (
          <p className="hint">{t('Укажите категорию и цену — покажем комиссию и сумму, которую вы получите.')}</p>
        )}

        <div className="field">
          <span className="label">{t('Фото — необязательно')}</span>
          <p className="hint" style={{ margin: '0 0 4px' }}>
            {t('До {n} фото. Первое — обложка в разделе и на странице лота.', { n: MAX_PHOTOS })}
          </p>
          {images.length > 0 && (
            <div className="photo-grid">
              {images.map((im, i) => (
                <div key={im.key} className="photo-item">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt="" />
                  {i === 0 ? (
                    <span className="photo-cover">{t('Обложка')}</span>
                  ) : (
                    <button
                      type="button"
                      className="photo-btn photo-make-cover"
                      aria-label={t('Сделать обложкой')}
                      title={t('Сделать обложкой')}
                      onClick={() => setImages((prev) => [prev[i]!, ...prev.filter((_, j) => j !== i)])}
                    >
                      <Star size={15} strokeWidth={1.75} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="photo-btn photo-remove"
                    aria-label={t('Убрать фото')}
                    title={t('Убрать фото')}
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X size={15} strokeWidth={1.75} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {images.length < MAX_PHOTOS && (
            <label className="btn secondary photo-add" aria-disabled={uploading || undefined}>
              <ImagePlus size={18} strokeWidth={1.75} aria-hidden />
              {uploading
                ? progress
                  ? t('Загружаем {progress}…', { progress })
                  : t('Загружаем…')
                : images.length
                  ? t('Ещё фото')
                  : t('Добавить фото')}
              <input type="file" accept="image/*" multiple onChange={onImages} disabled={uploading} hidden />
            </label>
          )}
          {uploadErr && (
            <p className="field-error" role="alert">
              {uploadErr}
            </p>
          )}
        </div>

        {err && <div className="alert error" role="alert">{err}</div>}
        <button className="btn lg block" type="submit" disabled={busy}>
          {busy
            ? editing
              ? t('Сохраняем…')
              : t('Публикуем…')
            : editing
              ? t('Сохранить изменения')
              : t('Опубликовать лот')}
        </button>
      </form>
    </div>
  );
}
