// Проверка английского интерфейса — запускается как тест веба.
//
// 1. Каждая фраза в t('…') и msg('…') есть в словаре src/lib/i18n/en/.
// 2. Формы слов в t.n(…) и t.word(…) есть в en/plural.ts.
// 3. Подстановки {name} в переводе те же, что в русской фразе.
// 4. Одна фраза в двух частях словаря переведена одинаково.
// 5. В переведённых файлах не осталось русского текста вне t() и msg():
//    забытая подпись иначе так и висела бы по-русски на английском сайте.
//    Строка с пометкой i18n-ignore пропускается (регулярки, примеры ввода),
//    блок между i18n-ignore-start и i18n-ignore-end — тоже (русские месяцы).
//
// Словари — TypeScript; Node 22 читает их сам, без сборки.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = new URL('../src/', import.meta.url).pathname;
const DICT = join(SRC, 'lib/i18n/en');

// Остаются русскими: консоль сотрудников и юридические документы — их
// английский перевод не имеет силы, страница честно говорит об этом.
const RUSSIAN_ONLY = [
  'app/admin/',
  'components/admin/',
  'app/oferta/',
  'app/privacy/',
  'app/contacts/',
  'components/legal-page.tsx',
  'components/json-ld.tsx',
  'app/sitemap.ts',
  'lib/i18n/',
];

// Ещё не переведены — сюда попадает файл, который переводят не сразу.
const NOT_YET = [];

// node scripts/i18n-check.mjs --only components/listing-form.tsx app/cabinet/lots —
// проверить только эти файлы, как будто они уже сняты с NOT_YET.
const args = process.argv.slice(2);
const only = args.includes('--only') ? args.filter((a) => !a.startsWith('--')) : null;
const under = (rel, list) => list.some((p) => rel === p || rel.startsWith(p));
const skip = (rel) => under(rel, RUSSIAN_ONLY) || (!only && under(rel, NOT_YET));

const errors = [];
const warnings = [];

// ── Словари ──
// Части: фразы (catalog.ts), данные (data-*.ts), формы слов (plural*.ts).
const phrases = {};
const data = {};
const plural = {};
const origin = new Map(); // словарь → фраза → файл
for (const f of readdirSync(DICT).sort()) {
  if (!f.endsWith('.ts') || f === 'index.ts') continue;
  const mod = await import(pathToFileURL(join(DICT, f)).href);
  const values = Object.values(mod);
  if (values.length !== 1) errors.push(`en/${f}: ожидается один экспорт словаря`);
  const target = f.startsWith('plural') ? plural : f.startsWith('data') ? data : phrases;
  for (const [ru, en] of Object.entries(values[0] ?? {})) {
    if (ru in target && JSON.stringify(target[ru]) !== JSON.stringify(en)) {
      errors.push(
        `«${ru}» переведена по-разному: ${origin.get(target)?.[ru]} — ${JSON.stringify(target[ru])}, en/${f} — ${JSON.stringify(en)}`,
      );
    }
    target[ru] = en;
    if (!origin.has(target)) origin.set(target, {});
    origin.get(target)[ru] = `en/${f}`;
  }
}

const holes = (s) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
for (const [ru, en] of [...Object.entries(data), ...Object.entries(phrases)]) {
  if (typeof en !== 'string' || !en.trim()) errors.push(`«${ru}»: пустой перевод`);
  else if (holes(ru) !== holes(en))
    errors.push(`«${ru}»: подстановки {${holes(ru)}} ≠ {${holes(en)}} в «${en}»`);
  else if (/[а-яё]/i.test(en)) errors.push(`«${ru}»: в переводе русские буквы — «${en}»`);
}
for (const [one, forms] of Object.entries(plural)) {
  if (!Array.isArray(forms) || forms.length !== 2) errors.push(`plural «${one}»: нужны две формы`);
  else if (forms.some((w) => /[а-яё]/i.test(w)))
    errors.push(`plural «${one}»: в переводе русские буквы`);
}

// ── Исходники ──
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})(SRC);

const STR = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\`(?:[^\`\\$]|\\.)*\`)`;
const CALL = new RegExp(String.raw`\b(?:t|msg)\(\s*` + STR, 'g');
const PLURAL = new RegExp(
  String.raw`\bt\.(?:n|word)\([^;]*?,\s*` +
    STR +
    String.raw`\s*,\s*` +
    STR +
    String.raw`\s*,\s*` +
    STR +
    String.raw`\s*\)`,
  'g',
);
const unquote = (lit) => lit.slice(1, -1).replace(/\\(.)/g, '$1');
const lineOf = (text, i) => text.slice(0, i).split('\n').length;
const blank = (s) => s.replace(/[^\n]/g, ' ');

const used = new Set();
const missing = {};
for (const file of files) {
  const rel = relative(SRC, file);
  if (rel.startsWith('lib/i18n/')) continue;
  if (only && !under(rel, only)) continue;
  const raw = readFileSync(file, 'utf8');
  let text = raw
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, (m, pre) => pre + blank(m.slice(pre.length)));

  for (const m of text.matchAll(CALL)) {
    const key = unquote(m[1]);
    used.add(key);
    if (!(key in phrases)) {
      errors.push(`${rel}:${lineOf(text, m.index)}: нет перевода «${key}»`);
      (missing[rel] ??= new Set()).add(key);
    }
  }
  for (const m of text.matchAll(PLURAL)) {
    const one = unquote(m[1]);
    if (!(one in plural))
      errors.push(`${rel}:${lineOf(text, m.index)}: нет форм для «${one}» в en/plural.ts`);
  }
  if (skip(rel)) continue;

  text = text.replace(CALL, blank).replace(PLURAL, blank);
  const rawLines = raw.split('\n');
  let ignoring = false;
  text.split('\n').forEach((line, i) => {
    const mark = rawLines[i] ?? '';
    if (/i18n-ignore-start/.test(mark)) ignoring = true;
    if (/i18n-ignore-end/.test(mark)) ignoring = false;
    if (ignoring || /i18n-ignore/.test(mark)) return;
    if (/[а-яё]/i.test(line))
      errors.push(`${rel}:${i + 1}: русский текст без t() — ${line.trim().slice(0, 90)}`);
  });
}

if (!only) {
  for (const ru of Object.keys(phrases)) {
    if (!used.has(ru)) warnings.push(`не используется: «${ru}» (${origin.get(phrases)?.[ru]})`);
  }
}

// node scripts/i18n-check.mjs --missing [путь] — фразы без перевода заготовкой словаря.
if (args.includes('--missing')) {
  const paths = args.filter((a) => !a.startsWith('--'));
  for (const [rel, keys] of Object.entries(missing)) {
    if (paths.length && !under(rel, paths)) continue;
    console.log(`  // ${rel}`);
    for (const k of keys) console.log(`  ${JSON.stringify(k)}: '',`);
  }
  process.exit(0);
}

for (const w of warnings) console.warn(`  · ${w}`);
for (const e of errors) console.error(`  ✕ ${e}`);
const total = Object.keys(phrases).length;
console.log(
  `i18n: ${total} фраз, ${Object.keys(data).length} данных, ${Object.keys(plural).length} слов; ` +
    `ошибок ${errors.length}, предупреждений ${warnings.length}`,
);
process.exit(errors.length ? 1 : 0);
