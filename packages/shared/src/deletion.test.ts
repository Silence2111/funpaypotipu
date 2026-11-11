import { describe, expect, it } from 'vitest';
import { DELETION_BALANCE_BLOCKS, DELETION_GRACE_DAYS, eraseAt, erasedUsername, forfeitBalance, hasBlockers } from './deletion';

describe('удаление аккаунта', () => {
  const none = { orders: 0, disputes: 0, balance: '0', payouts: 0, staff: false };

  it('ничего не мешает — можно удалять; любая сделка, спор, деньги, вывод или роль — нельзя', () => {
    expect(hasBlockers(none)).toBe(false);
    expect(hasBlockers({ ...none, orders: 1 })).toBe(true);
    expect(hasBlockers({ ...none, disputes: 1 })).toBe(true);
    expect(DELETION_BALANCE_BLOCKS).toBe(30000n);
    expect(hasBlockers({ ...none, balance: '30000' })).toBe(true);
    // Кэшбэк 20 ₽ вывести нельзя — он не мешает, но сгорит с подтверждением.
    expect(hasBlockers({ ...none, balance: '2000' })).toBe(false);
    expect(forfeitBalance({ ...none, balance: '2000' })).toBe(2000n);
    expect(forfeitBalance({ ...none, balance: '30000' })).toBe(0n);
    expect(forfeitBalance(none)).toBe(0n);
    expect(hasBlockers({ ...none, payouts: 2 })).toBe(true);
    expect(hasBlockers({ ...none, staff: true })).toBe(true);
  });

  it('данные уничтожаются через 30 дней после удаления', () => {
    expect(DELETION_GRACE_DAYS).toBe(30);
    expect(eraseAt('2026-11-11T10:00:00.000Z').toISOString()).toBe('2026-12-11T10:00:00.000Z');
  });

  it('ник удалённого — без прежнего ника и почты, стабильный по id', () => {
    const id = '3f1c2a9e-0b7d-4c55-9a11-22ab33cd44ef';
    expect(erasedUsername(id)).toBe('deleted_3f1c2a9e0b');
    expect(erasedUsername(id)).toMatch(/^[a-z0-9_]+$/);
  });
});
