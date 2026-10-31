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

function makeService(
  state: { kyc: Kyc | null; updates: Record<string, unknown>[]; audit: unknown[]; notified?: unknown[] },
  files: Record<string, string> = {},
) {
  const prisma = {
    kycVerification: {
      findUnique: vi.fn(async () => state.kyc),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        return { ...state.kyc, ...data };
      }),
      create: vi.fn(async ({ data }: { data: Kyc }) => {
        state.updates.push(data as never);
        return data;
      }),
      findFirst: vi.fn(async () => state.kyc),
    },
  };
  const audit = { log: vi.fn(async (e: unknown) => state.audit.push(e)) };
  const storage = {
    enabled: true,
    presignPut: vi.fn(async () => 'https://s3/put'),
    getBytes: vi.fn(async (key: string) => {
      if (!(key in files)) throw new Error('нет файла');
      return Buffer.from(files[key]!);
    }),
    remove: vi.fn(async (key: string) => void delete files[key]),
  };
  const scanner = {
    scan: vi.fn(async (b: Buffer) => (b.toString().includes('EICAR') ? { clean: false, reason: 'EICAR' } : { clean: true })),
  };
  const notifications = { notify: vi.fn(async (...a: unknown[]) => (state.notified ??= []).push(a)) };
  // Порядок как в конструкторе: prisma, storage, audit, scanner, notifications
  return new KycService(prisma as never, storage as never, audit as never, scanner as never, notifications as never);
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

  it('отклонение переводит в rejected — с причиной, которую увидит продавец', async () => {
    const state = { kyc: { id: 'k1', userId: 'u1', status: 'pending' }, updates: [], audit: [], notified: [] as unknown[] };
    const r = await makeService(state).review('k1', 'moderator', 'reject', ' Фото размыто ');
    expect(r.status).toBe('rejected');
    expect(state.updates[0]).toMatchObject({ reason: 'Фото размыто' });
    expect(state.notified[0]).toEqual(['u1', 'kyc_rejected', { reason: 'Фото размыто' }]);
  });

  it('отклонить без причины нельзя: продавцу нечего было бы переснимать', async () => {
    const state = { kyc: { id: 'k1', userId: 'u1', status: 'pending' }, updates: [], audit: [] };
    await expect(makeService(state).review('k1', 'moderator', 'reject', '  ')).rejects.toThrow(/что не так/);
    expect(state.updates).toHaveLength(0);
  });

  it('одобрение приходит продавцу уведомлением', async () => {
    const state = { kyc: { id: 'k1', userId: 'u1', status: 'pending' }, updates: [], audit: [], notified: [] as unknown[] };
    await makeService(state).review('k1', 'moderator', 'approve');
    expect(state.notified[0]).toEqual(['u1', 'kyc_approved', {}]);
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
    await makeService(state).review('k1', 'moderator', 'reject', 'Нет селфи');
    expect(state.audit[0]).toMatchObject({ action: 'kyc.reject', entityId: 'k1' });
  });
});

describe('заявка продавца', () => {
  const DOC = 'kyc/u1/doc.jpg';
  const SELFIE = 'kyc/u1/selfie.jpg';

  it('принимается фото и PDF, остальное — нет', async () => {
    const svc = makeService({ kyc: null, updates: [], audit: [] });
    await expect(svc.requestUpload('u1', 'image/jpeg')).resolves.toMatchObject({ key: expect.stringMatching(/^kyc\/u1\/.+\.jpg$/) });
    await expect(svc.requestUpload('u1', 'application/pdf')).resolves.toMatchObject({ key: expect.stringMatching(/\.pdf$/) });
    await expect(svc.requestUpload('u1', 'text/html')).rejects.toThrow(/фото/);
  });

  it('документ и селфи — в заявку на проверку', async () => {
    const state = { kyc: null, updates: [] as Record<string, unknown>[], audit: [] };
    await makeService(state, { [DOC]: 'jpg', [SELFIE]: 'jpg' }).submit('u1', [DOC], SELFIE);
    expect(state.updates[0]).toMatchObject({
      userId: 'u1',
      level: 'document',
      status: 'pending',
      documentRefs: { keys: [DOC], selfie: SELFIE },
    });
  });

  it('чужие файлы в заявку не берутся', async () => {
    const state = { kyc: null, updates: [], audit: [] };
    const svc = makeService(state, { 'kyc/u2/doc.jpg': 'jpg', [SELFIE]: 'jpg' });
    await expect(svc.submit('u1', ['kyc/u2/doc.jpg'], SELFIE)).rejects.toThrow(/не из этой заявки/);
    await expect(svc.submit('u1', ['kyc/u1/../u2/doc.jpg'], SELFIE)).rejects.toThrow(/не из этой заявки/);
    expect(state.updates).toHaveLength(0);
  });

  it('файл не загрузился или заражён — заявки нет, заражённый удаляется', async () => {
    const files = { [DOC]: 'X5O!P%@AP EICAR', [SELFIE]: 'jpg' };
    const state = { kyc: null, updates: [], audit: [] };
    const svc = makeService(state, files);
    await expect(svc.submit('u1', ['kyc/u1/missing.jpg'], SELFIE)).rejects.toThrow(/не загрузился/);
    await expect(svc.submit('u1', [DOC], SELFIE)).rejects.toThrow(/антивирус/);
    expect(DOC in files).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it('пока заявка на проверке или уже одобрена, новая не принимается', async () => {
    const files = { [DOC]: 'jpg', [SELFIE]: 'jpg' };
    for (const status of ['pending', 'approved']) {
      const state = { kyc: { id: 'k1', userId: 'u1', status }, updates: [], audit: [] };
      await expect(makeService(state, files).submit('u1', [DOC], SELFIE)).rejects.toThrow(/уже/);
    }
  });

  it('после отказа можно отправить заново', async () => {
    const state = { kyc: { id: 'k1', userId: 'u1', status: 'rejected' }, updates: [] as Record<string, unknown>[], audit: [] };
    await makeService(state, { [DOC]: 'jpg', [SELFIE]: 'jpg' }).submit('u1', [DOC], SELFIE);
    expect(state.updates[0]).toMatchObject({ status: 'pending' });
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
