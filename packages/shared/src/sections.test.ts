import { describe, expect, it } from 'vitest';
import {
  accountTransferMatch,
  attributeText,
  CLOSED_REASON_ACCOUNTS,
  CLOSED_REASON_BOOST,
  launchClosedReason,
} from './sections';

describe('launchClosedReason', () => {
  it('аккаунты и буст закрыты, остальное открыто', () => {
    expect(launchClosedReason({ segment: 'accounts', title: 'Аккаунты' })).toBe(CLOSED_REASON_ACCOUNTS);
    expect(launchClosedReason({ segment: 'service', title: 'Буст MMR' })).toBe(CLOSED_REASON_BOOST);
    expect(launchClosedReason({ segment: 'service', title: 'Буст кубков' })).toBe(CLOSED_REASON_BOOST);
    expect(launchClosedReason({ segment: 'service', title: 'Прокачка' })).toBe(CLOSED_REASON_BOOST);
    expect(launchClosedReason({ segment: 'service', title: 'Услуги' })).toBeNull();
    expect(launchClosedReason({ segment: 'items', title: 'Скины' })).toBeNull();
    expect(launchClosedReason({ segment: 'key', title: 'Ключи' })).toBeNull();
  });
});

describe('accountTransferMatch', () => {
  it.each([
    ['Продам аккаунт CS2 prime', 'продам аккаунт'],
    ['Логин и пароль сразу после оплаты', 'логин и пароль'],
    ['Выдача: логин/пароль', 'логин/пароль'],
    ['Передам все данные от аккаунта', 'данные от аккаунта'],
    ['Со сменой почты', 'сменой почты'],
    ['Родная почта в комплекте', 'родная почта'],
    ['Буст: зайду на ваш аккаунт вечером', 'зайду на ваш аккаунт'],
    ['Даю полный доступ к аккаунту', 'доступ к аккаунту'],
    ['Аренда аккаунта на сутки', 'аренда аккаунта'],
    ['Аккаунт с перепривязкой', 'перепривязкой'],
    ['Оффлайн-аккаунт Steam с игрой', 'оффлайн-аккаунт'],
    ['Общий доступ к библиотеке', 'общий доступ'],
    ['Selling my account with skins', 'selling my account'],
    ['login:pass instantly', 'login:pass'],
    ['Продаю свой акк', 'продаю свой акк'],
  ])('находит: %s', (text, found) => {
    expect(accountTransferMatch(text)).toBe(found);
  });

  it('латинские буквы в русском слове не прячут фразу', () => {
    expect(accountTransferMatch('Пpодам aккаунт')).toBe('продам аккаунт');
  });

  it('ё и регистр не мешают', () => {
    expect(accountTransferMatch('ПЕРЕДАЧА УЧЁТНОЙ ЗАПИСИ')).toBe('передача учетной записи');
  });

  it.each([
    'Ключ активируется на ваш аккаунт Steam',
    'Скины передаю через обмен Steam по ссылке',
    'Пополню ваш аккаунт по логину Steam',
    'Донат на ваш аккаунт по ID',
    'Голда на ваш аккаунт через аукцион',
    'Обучение игре в Discord, разбор демок',
    'Продам скины, передам предмет в игре',
    'Сопровождение в рейдах в пати',
    'Аккаунт не нужен — только ваш ник',
    '',
  ])('не трогает: %s', (text) => {
    expect(accountTransferMatch(text)).toBeNull();
  });

  it('смотрит и в характеристики', () => {
    const attrs = { delivery: 'Со сменой почты', prime: true, rank: 'Gold Nova' };
    expect(attributeText(attrs)).toBe('Со сменой почты Gold Nova');
    expect(accountTransferMatch('Скин AK-47', 'Описание', attributeText(attrs))).toBe('сменой почты');
    expect(attributeText(null)).toBe('');
  });
});
