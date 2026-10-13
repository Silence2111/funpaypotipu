import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListingsService } from '../src/modules/listings/listings.service';

/**
 * Управление своими лотами: изменить, снять, удалить, поднять все разом.
 *
 * Три вещи стоили денег или доверия:
 *   - заблокированный модератором лот продавец возвращал в продажу одним PATCH;
 *   - правкой можно было убрать обязательную характеристику;
 *   - удаление лота с продажами падало на внешнем ключе заказов.
 *
 * Prisma подменена: проверяются правила, а не драйвер базы.
 */

const HOUR = 3600 * 1000;

function setup(
  listing: Record<string, unknown> | null,
  opts: { orders?: number; attrs?: unknown[]; fulfillmentType?: string } = {},
) {
  const calls = { update: [] as unknown[], delete: [] as unknown[], updateMany: [] as unknown[], create: [] as unknown[] };
  const prisma = {
    category: { findFirst: vi.fn(async () => ({ id: 'c1', fulfillmentType: opts.fulfillmentType ?? 'manual' })) },
    listing: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        calls.create.push(a);
        return { id: 'l1', ...a.data };
      }),
      findUnique: vi.fn(async () => listing),
      findMany: vi.fn(async () => (listing ? [listing] : [])),
      update: vi.fn(async (a: unknown) => {
        calls.update.push(a);
        return { id: 'l1', ...(a as { data: object }).data };
      }),
      updateMany: vi.fn(async (a: unknown) => {
        calls.updateMany.push(a);
        return { count: 1 };
      }),
      delete: vi.fn(async (a: unknown) => calls.delete.push(a)),
    },
    order: { count: vi.fn(async () => opts.orders ?? 0) },
    favorite: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    attribute: { findMany: vi.fn(async () => opts.attrs ?? []) },
    profile: { findUnique: vi.fn(async () => ({ salesCount: 0 })) },
  };
  const search = { indexListing: vi.fn(async () => {}), removeListing: vi.fn(async () => {}) };
  const svc = new ListingsService(prisma as never, search as never, {} as never);
  return { svc, calls, prisma };
}

const MINE = {
  sellerId: 's1',
  status: 'active',
  categoryId: 'c1',
  topupMarkupBps: null,
  category: { fulfillmentType: 'manual' },
};

beforeEach(() => vi.clearAllMocks());

describe('изменение лота', () => {
  it('заблокированный модератором лот не возвращается в продажу продавцом', async () => {
    const { svc, calls } = setup({ ...MINE, status: 'blocked' });
    await expect(svc.update('s1', 'l1', { status: 'active' })).rejects.toThrow(/заблокирован модератором/);
    expect(calls.update).toHaveLength(0);
  });

  it('чужой лот не меняется', async () => {
    const { svc } = setup({ ...MINE, sellerId: 'другой' });
    await expect(svc.update('s1', 'l1', { title: 'Мой' })).rejects.toThrow(/не ваш лот/);
  });

  it('правкой нельзя убрать обязательную характеристику', async () => {
    const { svc, calls } = setup(MINE, {
      attrs: [{ key: 'rank', label: 'Звание', type: 'enum', isRequired: true, options: ['Silver'] }],
    });
    await expect(svc.update('s1', 'l1', { attributes: {} })).rejects.toThrow(/Звание/);
    expect(calls.update).toHaveLength(0);
  });

  it('снятый с продажи лот возвращается в продажу', async () => {
    const { svc, calls } = setup({ ...MINE, status: 'paused' });
    await svc.update('s1', 'l1', { status: 'active' });
    expect(calls.update).toHaveLength(1);
  });
});

describe('наличие лота', () => {
  const NEW = {
    gameId: 'g1',
    categoryId: 'c1',
    title: 'Золото, сервер Гордунни',
    description: 'Передаю через аукцион',
    price: '1500',
    currency: 'RUB' as const,
    attributes: {},
    images: [],
    topup: null,
    stock: null,
  };

  it('валюта поштучно: единица, пачка, минимум и наличие сохраняются', async () => {
    const { svc, calls } = setup(null);
    await svc.create('s1', { ...NEW, unitName: 'золота', pricePerUnits: 1000, minQty: 10_000, stock: 250_000 });
    expect(calls.create[0]).toMatchObject({
      data: { unitName: 'золота', pricePerUnits: 1000, minQty: 10_000, stock: 250_000, status: 'active' },
    });
  });

  it('пачка не из списка и валюта без наличия — не сохраняются', async () => {
    const { svc } = setup(null);
    await expect(svc.create('s1', { ...NEW, unitName: 'золота', pricePerUnits: 7, stock: 100 })).rejects.toThrow(/1 000/);
    await expect(svc.create('s1', { ...NEW, unitName: 'золота', pricePerUnits: 1000 })).rejects.toThrow(/наличие/);
  });

  it('у пополнения количества нет — у него сумма на выбор', async () => {
    const { svc } = setup(null, { fulfillmentType: 'provider' });
    await expect(svc.create('s1', { ...NEW, unitName: 'кристаллов', stock: 100 })).rejects.toThrow(/пополнений/);
  });

  it('лот ключей без ключей в каталог не выходит', async () => {
    const { svc, calls } = setup(null, { fulfillmentType: 'auto_key' });
    await svc.create('s1', { ...NEW, stock: 500 });
    // наличие ключей ведёт склад: ввод продавца не учитывается
    expect(calls.create[0]).toMatchObject({ data: { stock: 0, status: 'sold_out' } });
  });

  it('закончившийся лот не возвращается в продажу без наличия', async () => {
    const { svc, calls } = setup({ ...MINE, status: 'sold_out', unitName: 'золота', pricePerUnits: 1000, minQty: 1, stock: 0 });
    await expect(svc.update('s1', 'l1', { status: 'active' })).rejects.toThrow(/укажите наличие/);
    expect(calls.update).toHaveLength(0);
  });

  it('наличие обнулили правкой — лот уходит из каталога', async () => {
    const { svc, calls } = setup({ ...MINE, unitName: 'золота', pricePerUnits: 1000, minQty: 1, stock: 5_000 });
    await svc.update('s1', 'l1', { stock: 0 });
    expect(calls.update[0]).toMatchObject({ data: { stock: 0, status: 'sold_out' } });
  });

  it('продавец пополнил наличие — лот снова в продаже сам', async () => {
    const { svc, calls } = setup({ ...MINE, status: 'sold_out', unitName: 'золота', pricePerUnits: 1000, minQty: 1, stock: 0 });
    await svc.update('s1', 'l1', { stock: 80_000 });
    expect(calls.update[0]).toMatchObject({ data: { stock: 80_000, status: 'active' } });
  });
});

describe('удаление лота', () => {
  it('лот без заказов удаляется вместе с избранным', async () => {
    const { svc, calls, prisma } = setup(MINE, { orders: 0 });
    const r = await svc.remove('s1', 'l1');
    expect(r).toEqual({ ok: true, archived: false });
    expect(calls.delete).toHaveLength(1);
    expect(prisma.favorite.deleteMany).toHaveBeenCalled();
  });

  it('лот с заказами уходит в архив, а не ломает историю сделок', async () => {
    const { svc, calls } = setup(MINE, { orders: 3 });
    const r = await svc.remove('s1', 'l1');
    expect(r).toEqual({ ok: true, archived: true });
    expect(calls.delete).toHaveLength(0);
    expect(calls.update[0]).toMatchObject({ data: { status: 'archived' } });
  });

  it('заблокированный лот продавец не удаляет — это след для модерации', async () => {
    const { svc, calls } = setup({ ...MINE, status: 'blocked' });
    await expect(svc.remove('s1', 'l1')).rejects.toThrow(/заблокирован/);
    expect(calls.delete).toHaveLength(0);
  });
});

describe('поднять все лоты раздела', () => {
  it('поднимает лоты, у которых прошёл кулдаун', async () => {
    const { svc, calls } = setup({ id: 'l1', boostUntil: new Date(Date.now() - 24 * HOUR) });
    const r = await svc.bumpAll('s1', 'c1');
    expect(r.bumped).toBe(1);
    expect(calls.updateMany).toHaveLength(1);
  });

  it('недавно поднятый лот ждёт и говорит, сколько ждать', async () => {
    // Поднят 30 минут назад: boostUntil = сейчас − 30 мин + 24 ч, кулдаун новичка 4 ч
    const { svc, calls } = setup({ id: 'l1', boostUntil: new Date(Date.now() + 23.5 * HOUR) });
    const r = await svc.bumpAll('s1');
    expect(r.bumped).toBe(0);
    expect(r.waiting).toBe(1);
    expect(r.nextInMinutes).toBeGreaterThan(200);
    expect(r.nextInMinutes).toBeLessThanOrEqual(210);
    expect(calls.updateMany).toHaveLength(0);
  });
});
