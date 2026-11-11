import { describe, expect, it } from 'vitest';
import {
  IMPORT_MAX_FILE_ROWS,
  IMPORT_MAX_ROWS,
  importBatches,
  exportLots,
  importPrice,
  importTemplate,
  parseCsv,
  readImport,
  type ImportAttr,
} from './lot-import';

const ATTRS: ImportAttr[] = [
  {
    key: 'rank',
    label: 'Звание',
    type: 'enum',
    options: ['Silver', 'Global Elite'],
    isRequired: true,
  },
  { key: 'prime', label: 'Prime-статус', type: 'bool', isRequired: false },
  { key: 'hours', label: 'Часов в игре', type: 'text', isRequired: false },
];

describe('разбор CSV', () => {
  it('«;» из Excel, «,» из Google Таблиц, кавычки, переносы в ячейке и BOM', () => {
    expect(parseCsv('﻿Название;Цена\r\nАккаунт;"1 500,50"\r\n')).toEqual([
      ['Название', 'Цена'],
      ['Аккаунт', '1 500,50'],
    ]);
    expect(parseCsv('title,price\n"Скин ""Asiimov""",900\n"две\nстроки",10')).toEqual([
      ['title', 'price'],
      ['Скин "Asiimov"', '900'],
      ['две\nстроки', '10'],
    ]);
  });

  it('цена: пробелы, запятая, ₽; ноль и мусор — нет', () => {
    expect(importPrice('1 500,50 ₽')).toBe('150050');
    expect(importPrice('490')).toBe('49000');
    expect(importPrice('0')).toBeNull();
    expect(importPrice('пятьсот')).toBeNull();
    expect(importPrice('1.555')).toBeNull();
  });
});

describe('лоты из таблицы', () => {
  it('столбцы по заголовкам, характеристики по названию, ошибки — по строкам', () => {
    const table = parseCsv(
      [
        'Название;Описание;Цена, ₽;Наличие;Звание;Prime-статус;Часов в игре',
        'Аккаунт Prime;Почта в комплекте;1 200;;global elite;да;1500',
        'Ак;Коротко;500;;Silver;;',
        'Аккаунт без звания;Описание;700;;;нет;',
        'Аккаунт с ошибкой;Описание;дорого;;Silver;;',
        ';;;;;;',
        'Аккаунт Silver;Описание;650;3;Silver;возможно;',
      ].join('\n'),
    );
    const read = readImport(table, ATTRS);
    expect(read.fatal).toBeNull();
    expect(read.lots).toEqual([
      {
        line: 2,
        title: 'Аккаунт Prime',
        description: 'Почта в комплекте',
        price: '120000',
        stock: null,
        attributes: { rank: 'Global Elite', prime: true, hours: '1500' },
      },
    ]);
    expect(read.errors).toEqual([
      { line: 3, message: 'Название — от 3 до 120 знаков' },
      { line: 4, message: 'Укажите характеристику «Звание»' },
      { line: 5, message: 'Цена — число больше нуля, например 490' },
      { line: 7, message: '«Prime-статус» — «да» или «нет»' },
    ]);
  });

  it('таблица целиком: нет столбца, лишний столбец, пусто, слишком много строк', () => {
    expect(readImport(parseCsv('Название;Описание\nА;Б'), ATTRS).fatal).toBe('Нет столбца «Цена»');
    expect(readImport(parseCsv('Название;Описание;Цена;Сервер\nАкк;Б;1;x'), ATTRS).fatal).toBe(
      'Неизвестный столбец «Сервер» — уберите его или переименуйте',
    );
    expect(readImport(parseCsv('title;description;price;rank\n'), ATTRS).fatal).toBe(
      'В таблице нет строк с лотами',
    );
    // Больше порции API — не ошибка: сайт загрузит по частям; больше таблицы — да.
    const rows = (n: number) => [
      'title;description;price;rank',
      ...Array.from({ length: n }, (_, i) => `Лот ${i};О;1;Silver`),
    ];
    const big = readImport(parseCsv(rows(IMPORT_MAX_ROWS + 50).join('\n')), ATTRS);
    expect(big.fatal).toBeNull();
    expect(big.lots).toHaveLength(IMPORT_MAX_ROWS + 50);
    expect(readImport(parseCsv(rows(IMPORT_MAX_FILE_ROWS + 1).join('\n')), ATTRS).fatal).toBe(
      `Не больше ${IMPORT_MAX_FILE_ROWS} лотов в одной таблице — разделите её`,
    );
  });

  it('порции по 200 — номера строк на месте', () => {
    const lots = Array.from({ length: 450 }, (_, i) => ({ line: i + 2 }));
    const parts = importBatches(lots);
    expect(parts.map((p) => p.length)).toEqual([200, 200, 50]);
    expect(parts[2]![0]!.line).toBe(402);
    expect(importBatches([])).toEqual([]);
  });

  it('шаблон с примерами: значения допустимые, но сами примеры не выставятся', () => {
    const csv = importTemplate(ATTRS, 'ru', { what: 'Аккаунты Counter-Strike 2' });
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^Пример: Аккаунты Counter-Strike 2;/);
    const read = readImport(parseCsv(csv), ATTRS);
    expect(read.lots).toHaveLength(0);
    expect(read.errors.map((e) => e.message)).toEqual([
      'Строка-пример из шаблона — удалите её или замените своим лотом',
      'Строка-пример из шаблона — удалите её или замените своим лотом',
    ]);
    // Свой лот вместо примера — выставляется.
    const mine = csv.replace('Пример: Аккаунты Counter-Strike 2;', 'Аккаунт Global Elite;');
    expect(readImport(parseCsv(mine), ATTRS).lots).toHaveLength(1);
    expect(importTemplate(ATTRS, 'en', { what: 'CS2 accounts' })).toMatch(/\r\nExample: CS2 accounts;/);
  });

  it('шаблон — заголовки раздела; по-английски — ключи, и их таблица понимает', () => {
    expect(importTemplate(ATTRS)).toBe(
      'Название;Описание;Цена, ₽;Наличие;Звание;Prime-статус;Часов в игре\r\n',
    );
    const en = importTemplate(ATTRS, 'en');
    expect(en).toBe('title;description;price;stock;rank;prime;hours\r\n');
    expect(
      readImport(parseCsv(`${en}Account;Text;10;2;Silver;yes;\n`), ATTRS).lots[0],
    ).toMatchObject({
      price: '1000',
      stock: 2,
      attributes: { rank: 'Silver', prime: true },
    });
  });
});

describe('выгрузка своих лотов и обратно', () => {
  const ID1 = '11111111-2222-4333-8444-555555555555';
  const ID2 = '66666666-7777-4888-8999-aaaaaaaaaaaa';
  const lots = [
    {
      id: ID1,
      title: 'Аккаунт; «Prime»',
      description: 'Строка 1\nСтрока 2 — "почта" в комплекте',
      price: '120050',
      stock: 3,
      attributes: { rank: 'Global Elite', prime: true, hours: '1500' },
    },
    {
      id: ID2,
      title: 'Аккаунт Silver',
      description: 'Без почты',
      price: '65000',
      stock: null,
      attributes: { rank: 'Silver' },
    },
  ];

  it('ID и столбцы шаблона; цена с копейками через запятую; обратно — те же лоты с ID', () => {
    const csv = exportLots(lots, ATTRS);
    expect(csv.split('\r\n')[0]).toBe(
      'ID;Название;Описание;Цена, ₽;Наличие;Звание;Prime-статус;Часов в игре',
    );
    expect(csv).toContain(';1200,50;3;Global Elite;да;1500');
    const read = readImport(parseCsv(csv), ATTRS);
    expect(read.errors).toEqual([]);
    expect(read.lots).toEqual([
      { line: 2, ...lots[0] },
      { line: 3, ...lots[1] },
    ]);
    expect(exportLots(lots, ATTRS, 'en')).toContain(';1200.50;3;Global Elite;yes;1500');
  });

  it('строка с ID: пустые описание и характеристика — оставить; неверный и повторный ID — ошибка', () => {
    const table = parseCsv(
      [
        'ID;Название;Описание;Цена;Звание',
        `${ID1};Аккаунт новый заголовок;;990;`,
        `не-id;Аккаунт;Описание;10;Silver`,
        `${ID1};Аккаунт ещё раз;Описание;10;Silver`,
        `;Новый аккаунт;Описание;10;Silver`,
      ].join('\n'),
    );
    const read = readImport(table, ATTRS);
    expect(read.lots.map((l) => [l.line, l.id, l.description, l.attributes])).toEqual([
      [2, ID1, '', {}],
      [5, undefined, 'Описание', { rank: 'Silver' }],
    ]);
    expect(read.errors).toEqual([
      { line: 3, message: 'Неверный ID — оставьте его как в выгрузке или очистите' },
      { line: 4, message: 'Этот лот уже есть в таблице выше' },
    ]);
  });

  it('английские столбцы (часть 144): читаются, проверяются, выгружаются туда же', () => {
    const r = readImport(
      parseCsv('Название;Описание;Цена;Звание;Название (англ.);Описание (англ.)\nАкк;Б;100;Global Elite;CS2 account;Prime, 2000 hours\nАкк2;Б;100;Global Elite;Акк;'),
      ATTRS,
    );
    expect(r.lots[0]).toMatchObject({ titleEn: 'CS2 account', descriptionEn: 'Prime, 2000 hours' });
    expect(r.errors).toEqual([{ line: 3, message: 'Название на английском — латиницей' }]);
    const csv = exportLots(
      [{ id: '11111111-1111-4111-8111-111111111111', title: 'Акк', description: 'Б', price: '10000', stock: null, attributes: {}, titleEn: 'CS2 account', descriptionEn: null }],
      [],
    );
    expect(csv.split('\r\n')[0]).toBe('ID;Название;Описание;Цена, ₽;Наличие;Название (англ.);Описание (англ.)');
    const back = readImport(parseCsv(csv), []);
    expect(back.lots[0]).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', titleEn: 'CS2 account' });
    expect(back.lots[0]?.descriptionEn).toBeUndefined();
  });
});
