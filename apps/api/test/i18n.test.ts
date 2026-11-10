import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { EN_SHARED } from '@gamemarket/shared';
import { EN_API } from '../src/i18n/en';
import { requestLang } from '../src/i18n/lang';
import { toEnglish } from '../src/i18n/translate';
import { I18nExceptionFilter } from '../src/common/i18n-exception.filter';

/**
 * Ошибки API на английском. Главное — ничего не забыть: сканер ниже
 * находит в apps/api/src русские тексты исключений (new XxxException(…),
 * ticketError(…)) и проверок zod (.min(…, 'текст'), .refine(…, 'текст')),
 * и каждый должен переводиться. И ничего не сломать: русский ответ —
 * байт в байт прежний.
 */

const SRC = join(__dirname, '../src');
const CYRILLIC = /[а-яё]/i;
const ZOD = new Set([
  'min',
  'max',
  'length',
  'regex',
  'refine',
  'superRefine',
  'email',
  'url',
  'nonempty',
  'addIssue',
]);

interface Found {
  file: string;
  line: number;
  /** Текст; подстановки шаблонной строки — {0}, {1}. */
  text: string;
}

function scan(): Found[] {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.includes('/i18n/')) files.push(p);
    }
  })(SRC);

  const found: Found[] = [];
  for (const file of files) {
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    // Текст исключения часто лежит в переменной: const [status, message] = …
    const decls = new Map<string, ts.Expression[]>();
    (function collect(n: ts.Node) {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const init = n.initializer;
        (function bind(b: ts.BindingName) {
          if (ts.isIdentifier(b)) decls.set(b.text, [...(decls.get(b.text) ?? []), init]);
          else b.elements.forEach((e) => !ts.isOmittedExpression(e) && bind(e.name));
        })(n.name);
      }
      ts.forEachChild(n, collect);
    })(src);

    const texts = (node: ts.Node, out: string[], seen = new Set<string>()) => {
      (function v(n: ts.Node) {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
          if (CYRILLIC.test(n.text)) out.push(n.text);
          return;
        }
        if (ts.isTemplateExpression(n)) {
          const s = n.templateSpans.reduce(
            (acc, sp, i) => `${acc}{${i}}${sp.literal.text}`,
            n.head.text,
          );
          if (CYRILLIC.test(s)) out.push(s);
          return;
        }
        if (ts.isIdentifier(n)) {
          if (!seen.has(n.text)) {
            seen.add(n.text);
            decls.get(n.text)?.forEach(v);
          }
          return;
        }
        if (ts.isShorthandPropertyAssignment(n)) return v(n.name);
        if (ts.isPropertyAssignment(n)) {
          if (n.name.getText().replace(/['"]/g, '') === 'message') v(n.initializer);
          return;
        }
        if (ts.isCallExpression(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return;
        if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) return;
        ts.forEachChild(n, v);
      })(node);
    };

    (function visit(n: ts.Node) {
      let args: readonly ts.Expression[] | null = null;
      if (ts.isNewExpression(n) && /Exception$/.test(n.expression.getText()))
        args = n.arguments ?? [];
      else if (ts.isCallExpression(n)) {
        const callee = n.expression;
        if (ts.isIdentifier(callee) && /Error$/.test(callee.text)) args = n.arguments;
        else if (ts.isPropertyAccessExpression(callee) && ZOD.has(callee.name.text)) {
          args = callee.name.text === 'addIssue' ? n.arguments : n.arguments.slice(1);
        }
      }
      if (args) {
        const out: string[] = [];
        for (const a of args) texts(a, out);
        const line = src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        for (const text of out) found.push({ file: relative(SRC, file), line, text });
      }
      ts.forEachChild(n, visit);
    })(src);
  }
  return found;
}

describe('ошибки API переведены', () => {
  const found = scan();

  it('сканер находит тексты ошибок', () => {
    expect(found.length).toBeGreaterThan(150);
    expect(found.map((f) => f.text)).toContain('Заказ не найден');
    // Текст из переменной и из вспомогательной функции
    expect(found.map((f) => f.text)).toContain('Введите код из приложения-аутентификатора');
    expect(found.map((f) => f.text)).toContain('Этот ник занят');
    // Проверка zod в контроллере
    expect(found.map((f) => f.text)).toContain('Тема — от 3 символов');
  });

  it('у каждого текста есть английский', () => {
    const missing = found
      .filter((f) => toEnglish(f.text.replace(/\{\d+\}/g, '7')) === undefined)
      .map((f) => `${f.file}:${f.line} ${f.text}`);
    expect(missing).toEqual([]);
  });

  it('словарь: без русских букв, подстановки те же, с общим словарём не спорит', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [ru, en] of Object.entries(EN_API)) {
      expect(en, ru).not.toMatch(CYRILLIC);
      expect(holes(en), ru).toEqual(holes(ru));
      if (ru in EN_SHARED) expect(en, ru).toBe(EN_SHARED[ru]);
    }
  });

  it('подставленное значение переводится, русские данные в кавычках остаются', () => {
    expect(toEnglish('Поднять можно через 12 мин')).toBe('You can raise it again in 12 min');
    expect(toEnglish('Минимальная сумма вывода для «СБП» — 300 ₽')).toBe(
      'The minimum withdrawal for “SBP (Faster Payments)” is 300 ₽',
    );
    expect(toEnglish('Файл не прошёл антивирус-проверку: превышен лимит 20 МБ')).toBe(
      'The file failed the antivirus check: the 20 MB size limit is exceeded',
    );
    expect(toEnglish('Укажите характеристику «Ранг»')).toBe('Fill in “Ранг”');
  });

  it('слишком общий шаблон не выдаёт полурусский текст', () => {
    expect(toEnglish('Совсем другое сообщение на 5 МБ')).toBeUndefined();
    expect(toEnglish('Новая ошибка без перевода')).toBeUndefined();
    expect(toEnglish('Already English')).toBeUndefined();
  });
});

describe('requestLang', () => {
  it('русский, если он есть среди языков; без заголовка — русский', () => {
    expect(requestLang(undefined)).toBe('ru');
    expect(requestLang('')).toBe('ru');
    expect(requestLang('*')).toBe('ru');
    expect(requestLang('ru')).toBe('ru');
    expect(requestLang('en-US,en;q=0.9,ru;q=0.8')).toBe('ru');
    expect(requestLang('uk-UA')).toBe('ru');
    expect(requestLang('kk-KZ,en')).toBe('ru');
    expect(requestLang('en')).toBe('en');
    expect(requestLang('de-DE,de-BE;q=0.8')).toBe('en');
  });
});

describe('I18nExceptionFilter', () => {
  function reply(filter: BaseExceptionFilter, exception: HttpException, lang?: string) {
    const sent: { body?: unknown; status?: number } = {};
    const app = {
      isHeadersSent: () => false,
      reply: (_res: unknown, body: unknown, status: number) =>
        Object.assign(sent, { body, status }),
      end: () => undefined,
    };
    Object.assign(filter, { applicationRef: app });
    const req = { headers: lang ? { 'accept-language': lang } : {} };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
      getArgByIndex: (i: number) => (i === 0 ? req : {}),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return sent;
  }
  const filter = () => new I18nExceptionFilter();
  const nest = (e: HttpException, lang?: string) =>
    JSON.stringify(reply(new BaseExceptionFilter(), e, lang));

  it('русский запрос и запрос без языка — ответ как у Nest, байт в байт', () => {
    const cases = [
      () => new NotFoundException('Заказ не найден'),
      () =>
        new HttpException(
          {
            statusCode: 400,
            message: 'Выберите ник',
            error: 'username_required',
            suggested: 'anna',
          },
          400,
        ),
      () => new BadRequestException({ subject: ['Тема — от 3 символов'] }),
      () => new HttpException('Пустое сообщение', 400),
    ];
    for (const make of cases) {
      expect(JSON.stringify(reply(filter(), make(), 'ru'))).toBe(nest(make(), 'ru'));
      expect(JSON.stringify(reply(filter(), make()))).toBe(nest(make()));
    }
  });

  it('английский: текст переведён, остальное как было, lang: en', () => {
    expect(reply(filter(), new NotFoundException('Заказ не найден'), 'en')).toEqual({
      status: 404,
      body: { statusCode: 404, message: 'Order not found', error: 'Not Found', lang: 'en' },
    });
    const social = reply(
      filter(),
      new HttpException(
        {
          statusCode: 400,
          message: 'Выберите ник — по нему вас найдут покупатели и продавцы',
          error: 'username_required',
          suggested: 'anna_smirnova',
          name: 'Анна Смирнова',
          provider: 'google',
        },
        400,
      ),
      'en',
    );
    expect(social.body).toEqual({
      statusCode: 400,
      message: 'Choose a username — buyers and sellers will find you by it',
      error: 'username_required',
      suggested: 'anna_smirnova',
      name: 'Анна Смирнова',
      provider: 'google',
      lang: 'en',
    });
  });

  it('английский: строка HttpException, массив и поля проверки', () => {
    expect(reply(filter(), new HttpException('Пустое сообщение', 400), 'en').body).toEqual({
      statusCode: 400,
      message: 'The message is empty',
      lang: 'en',
    });
    expect(
      reply(
        filter(),
        new HttpException({ statusCode: 400, message: ['Нечего менять', 'Required'] }, 400),
        'en',
      ).body,
    ).toEqual({ statusCode: 400, message: ['Nothing to change', 'Required'], lang: 'en' });
    expect(
      reply(
        filter(),
        new BadRequestException({ subject: ['Тема — от 3 символов'], body: ['Required'] }),
        'en',
      ).body,
    ).toEqual({
      subject: ['Subject must be at least 3 characters'],
      body: ['Required'],
      lang: 'en',
    });
  });

  it('английский без перевода — ответ как у Nest, без lang', () => {
    const cases = [
      () => new BadRequestException('Новая ошибка без перевода'),
      () => new ForbiddenException(),
      () => new BadRequestException({ title: ['Required'] }),
    ];
    for (const make of cases)
      expect(JSON.stringify(reply(filter(), make(), 'en'))).toBe(nest(make(), 'en'));
  });
});
