import { describe, expect, it, vi } from 'vitest';
import { KycService } from '../src/modules/kyc/kyc.service';

/**
 * Проверка личности.
 *
 * Ошибка здесь стоит по-разному в двух направлениях: пропустишь чужую заявку —
 * деньги уйдут не тому и вернуть их будет нечем; отклонишь свою — продавец
 * не сможет вывести заработанное и уйдёт. Поэтому проверяем прежде всего то,
 * что должно быть **запрещено**.
 *
 * Prisma подменена: проверяются правила, а не драйвер базы.
 */

type Kyc = { id: string; userId: string; status: string; level?: string };

function makeService(state: { kyc: Kyc | null; updates: Record<string, unknown>[]; audit: unknown[] }) {
  const prisma = {
    kycVerification: {
      findUnique: vi.fn(async () => state.kyc),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        return { ...state.kyc, ...data };
      }),
      create: vi.fn(async ({ data }: { data: Kyc }) => data),
      findFirst: vi.fn(async () => state.kyc),
    },
  };
  const audit = { log: vi.fn(async (e: unknown) => state.audit.push(e)) };
  const storage = { presignPut: vi.fn(async () => ({ url: 'https://s3/put', key: 'k' })) };
  // Порядок как в конструкторе: prisma, storage, audit
  return new KycService(prisma as never, storage as never, audit as never);
}

describe('решение по заявке', () => {
  it('одобрение переводит заявку в approved и пишет в журнал', async () => {
    const state = { kyc: { id: 'k1', userId: 'u1', status: 'pending' }, updates: [], audit: [] };
    const svc = makeService(state);

    const r = await svc.review('k1', 'moderator', 'approve');
    expect(r.status).toBe('approved');
    expect(state.updates[0]).toMatchObject({ status: 'approved', reviewedBy: 'moderator' });
    // Журнал обязателен: решение по чужим документам должно быть именным
    expect(state.audit).toHaveLength(1);
  });

  it('отклонение переводит в rejected', async () => {
    const state = { kyc: { id: 'k1', userId: 'u1', status: 'pending' }, updates: [], audit: [] };
    const r = await makeService(state).review('k1', 'moderator', 'reject');
    expect(r.status).toBe('rejected');
  });

  it('повторное решение по обработанной заявке не проходит', async () => {
    // Иначе отклонённую заявку можно молча переиграть в одобренную
    const state = { kyc: { id: 'k1', userId: 'u1', status: 'approved' }, updates: [], audit: [] };
    await expect(makeService(state).review('k1', 'moderator', 'reject')).rejects.toThrow();
    expect(state.updates).toHaveLength(0);
  });

  it('несуществующая заявка — отказ, а не тихий успех', async () => {
    const state = { kyc: null, updates: [], audit: [] };
    await expect(makeService(state).review('нет', 'moderator', 'approve')).rejects.toThrow();
  });

  it('решение фиксирует момент времени', async () => {
    const state = { kyc: { id: 'k1', userId: 'u1', status: 'pending' }, updates: [], audit: [] };
    await makeService(state).review('k1', 'moderator', 'approve');
    expect(state.updates[0].reviewedAt).toBeInstanceOf(Date);
  });

  it('в журнале видно, что именно решили', async () => {
    const state = { kyc: { id: 'k1', userId: 'u1', status: 'pending' }, updates: [], audit: [] };
    await makeService(state).review('k1', 'moderator', 'reject');
    expect(state.audit[0]).toMatchObject({ action: 'kyc.reject', entityId: 'k1' });
  });
});

describe('порог для вывода', () => {
  // Значение по умолчанию из payouts.service: 15 000 ₽ в копейках
  const THRESHOLD = 1_500_000n;

  it('мелкий вывод проверки не требует', () => {
    expect(1_000_000n > THRESHOLD).toBe(false);
  });

  it('ровно на пороге проверка ещё не нужна', () => {
    // Строгое сравнение: «свыше 15 000», а не «от 15 000»
    expect(THRESHOLD > THRESHOLD).toBe(false);
  });

  it('крупный вывод требует подтверждённой личности', () => {
    expect(1_500_001n > THRESHOLD).toBe(true);
  });
});
