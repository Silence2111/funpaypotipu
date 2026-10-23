import { describe, expect, it } from 'vitest';
import {
  IMPORT_MAX_ROWS,
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
    const many = [
      'title;description;price;rank',
      ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `Лот ${i};О;1;Silver`),
    ];
    expect(readImport(parseCsv(many.join('\n')), ATTRS).fatal).toBe(
      `Не больше ${IMPORT_MAX_ROWS} лотов за раз — разделите таблицу`,
    );
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
});
