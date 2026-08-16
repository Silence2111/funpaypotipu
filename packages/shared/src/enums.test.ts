import { describe, it, expect } from 'vitest';
import { ORDER_STATUS, ORDER_TRANSITIONS, canTransition, type OrderStatus } from './enums';

/**
 * Машина состояний заказа — второе по важности место после бухгалтерии:
 * лишний переход означает либо товар без оплаты, либо деньги без товара.
 * До сих пор она не была покрыта ничем.
 */
describe('машина состояний заказа', () => {
  it('нормальный путь проходит целиком', () => {
    const path: OrderStatus[] = ['created', 'paid', 'delivered', 'completed'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('нельзя выдать товар до оплаты', () => {
    expect(canTransition('created', 'delivered')).toBe(false);
  });

  it('нельзя завершить заказ, минуя выдачу', () => {
    expect(canTransition('paid', 'completed')).toBe(false);
  });

  it('спор открывается только после оплаты или выдачи', () => {
    expect(canTransition('paid', 'disputed')).toBe(true);
    expect(canTransition('delivered', 'disputed')).toBe(true);
    expect(canTransition('created', 'disputed')).toBe(false);
  });

  it('спор заканчивается возвратом или завершением', () => {
    expect(canTransition('disputed', 'refunded')).toBe(true);
    expect(canTransition('disputed', 'completed')).toBe(true);
  });

  it('неоплаченный заказ можно отменить, оплаченный — нет', () => {
    // Оплаченный только через возврат: деньги уже в эскроу
    expect(canTransition('created', 'cancelled')).toBe(true);
    expect(canTransition('paid', 'cancelled')).toBe(false);
  });

  it('деньги не возвращают из неоплаченного', () => {
    expect(canTransition('created', 'refunded')).toBe(false);
  });

  describe('конечные состояния', () => {
    const terminal: OrderStatus[] = ['completed', 'refunded', 'cancelled', 'expired'];

    it('из них нет выходов', () => {
      for (const s of terminal) {
        expect(ORDER_TRANSITIONS[s]).toEqual([]);
      }
    });

    it('завершённый заказ нельзя вернуть в спор', () => {
      // Иначе покупатель открывает спор через месяц после выдачи ключа
      expect(canTransition('completed', 'disputed')).toBe(false);
      expect(canTransition('refunded', 'disputed')).toBe(false);
    });
  });

  it('в себя переходов нет ни у одного статуса', () => {
    for (const s of ORDER_STATUS) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it('у каждого статуса описан список переходов', () => {
    // Забытый статус вернул бы undefined и молча запретил всё
    for (const s of ORDER_STATUS) {
      expect(Array.isArray(ORDER_TRANSITIONS[s])).toBe(true);
    }
  });

  it('переходы ведут только в существующие статусы', () => {
    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS)) {
      for (const to of targets) {
        expect(ORDER_STATUS).toContain(to);
      }
      expect(ORDER_STATUS).toContain(from as OrderStatus);
    }
  });

  it('неизвестный статус не открывает переходов', () => {
    expect(canTransition('чушь' as OrderStatus, 'paid')).toBe(false);
  });

  it('из каждого неконечного статуса есть куда пойти', () => {
    const live: OrderStatus[] = ['created', 'paid', 'delivered', 'disputed'];
    for (const s of live) expect(ORDER_TRANSITIONS[s].length).toBeGreaterThan(0);
  });
});
