import { describe, expect, it } from 'vitest';
import { buyerDataError, buyerFieldsOf, cleanBuyerData } from './buyer-data';

const FIELDS = [
  { label: 'Ник в игре', required: true },
  { label: 'Сервер', required: false },
];

describe('данные от покупателя', () => {
  it('обязательное поле не пропустить', () => {
    expect(buyerDataError(FIELDS, {})).toBe('Укажите «Ник в игре»');
    expect(buyerDataError(FIELDS, { 'Ник в игре': '   ' })).toBe('Укажите «Ник в игре»');
    expect(buyerDataError(FIELDS, { 'Ник в игре': 'Dragon_77' })).toBeNull();
  });

  it('длинный ответ не принимается', () => {
    expect(buyerDataError(FIELDS, { 'Ник в игре': 'x'.repeat(101) })).toMatch(/100/);
  });

  it('в заказ — только поля лота, по порядку и без пустых', () => {
    expect(cleanBuyerData(FIELDS, { Сервер: ' EU-1 ', 'Ник в игре': 'Dragon_77', лишнее: 'x' })).toEqual([
      { label: 'Ник в игре', value: 'Dragon_77' },
      { label: 'Сервер', value: 'EU-1' },
    ]);
  });

  it('мусор из базы не превращается в поля', () => {
    expect(buyerFieldsOf(null)).toEqual([]);
    expect(buyerFieldsOf([{ label: 'Ник' }, { foo: 1 }, 'x'])).toEqual([{ label: 'Ник', required: true }]);
  });
});
