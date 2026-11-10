import { describe, expect, it, vi } from 'vitest';
import { CatalogAdminService } from '../src/modules/catalog/catalog-admin.service';
import { seedCatalog } from '../../../packages/db/prisma/catalog';

/**
 * Каталог в консоли. Раньше игру и раздел заводили только сидом — выкатом
 * программиста. Проверяется то, что может сломать торговлю: тип товара и
 * способ выдачи раздела с лотами не меняются, порядок — ровно своих
 * разделов, у выбора из списка — варианты, обложка — не SVG; всё — в
 * журнале и с отметкой для сида.
 */

const G = '0b6f6c1e-4a2b-4c3d-8e9f-0000000000a1';
const C1 = '0b6f6c1e-4a2b-4c3d-8e9f-0000000000c1';
const C2 = '0b6f6c1e-4a2b-4c3d-8e9f-0000000000c2';

function setup(opts: { listings?: number; gameExists?: boolean } = {}) {
  const game = { id: G, slug: 'tl', title: 'Throne and Liberty', kind: 'game', aliases: [], isActive: true, sortOrder: 100, coverUrl: null };
  const category = { id: C1, gameId: G, slug: 'accounts', title: 'Аккаунты', segment: 'accounts', fulfillmentType: 'manual', isActive: true, unitName: null, pricePerUnits: null };
  const prisma = {
    game: {
      findUnique: vi.fn(async ({ where }: { where: { slug?: string; id?: string } }) =>
        where.slug ? (opts.gameExists ? { id: G } : null) : game,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...game, ...data, id: G })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...game, ...data })),
    },
    category: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string } }) => (where.id ? category : null)),
      findMany: vi.fn(async () => [
        { id: C1, sortOrder: 1 },
        { id: C2, sortOrder: 2 },
      ]),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...category, ...data })),
      aggregate: vi.fn(async () => ({ _max: { sortOrder: 4 } })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...category, ...data, id: C2 })),
    },
    attribute: {
      findUnique: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _max: { sortOrder: null } })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'a1', ...data })),
    },
    listing: { count: vi.fn(async () => opts.listings ?? 0) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  const audit = { log: vi.fn(async () => ({})) };
  const storage = { enabled: true, put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
  return { svc: new CatalogAdminService(prisma as never, audit as never, storage as never), prisma, audit, storage };
}

describe('каталог в консоли', () => {
  it('новая игра — с отметкой для сида и в журнале; адрес занят — 409', async () => {
    const { svc, prisma, audit } = setup();
    await svc.createGame('adm', { slug: 'tl', title: 'Throne and Liberty', kind: 'game' as never, aliases: ['тл'] });
    expect(prisma.game.create.mock.calls[0]![0].data).toMatchObject({ slug: 'tl', sortOrder: 100, editedAt: expect.any(Date) });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'catalog.game.create', entityType: 'game', after: expect.objectContaining({ title: 'Throne and Liberty' }) }));
    await expect(setup({ gameExists: true }).svc.createGame('adm', { slug: 'tl', title: 'X', kind: 'game' as never })).rejects.toThrow('уже есть');
  });

  it('скрыть игру — было и стало в журнале', async () => {
    const { svc, audit } = setup();
    await svc.updateGame('adm', G, { isActive: false });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'catalog.game.update', before: expect.objectContaining({ isActive: true }), after: expect.objectContaining({ isActive: false }) }),
    );
  });

  it('у раздела с лотами тип товара и выдача не меняются, название — меняется', async () => {
    const { svc } = setup({ listings: 3 });
    await expect(svc.updateCategory('adm', C1, { segment: 'key' as never })).rejects.toThrow('уже есть лоты');
    await expect(svc.updateCategory('adm', C1, { fulfillmentType: 'auto_key' as never })).rejects.toThrow('уже есть лоты');
    await expect(svc.updateCategory('adm', C1, { title: 'Аккаунты PvP' })).resolves.toMatchObject({ title: 'Аккаунты PvP' });
  });

  it('новый раздел — в конец игры', async () => {
    const { svc, prisma } = setup();
    await svc.createCategory('adm', G, { slug: 'gold', title: 'Золото', segment: 'currency' as never, fulfillmentType: 'manual' as never, unitName: 'шт', pricePerUnits: 1000 });
    expect(prisma.category.create.mock.calls[0]![0].data).toMatchObject({ sortOrder: 5, unitName: 'шт', pricePerUnits: 1000 });
  });

  it('порядок — ровно разделы этой игры: чужой, пропущенный, повтор — 400', async () => {
    const { svc, prisma } = setup();
    await svc.orderCategories('adm', G, [C2, C1]);
    expect(prisma.category.update.mock.calls.map((c) => c[0].data.sortOrder)).toEqual([1, 2]);
    await expect(svc.orderCategories('adm', G, [C1])).rejects.toThrow('устарел');
    await expect(svc.orderCategories('adm', G, [C1, C1])).rejects.toThrow('устарел');
    await expect(svc.orderCategories('adm', G, [C1, G])).rejects.toThrow('устарел');
  });

  it('поля: выбор из списка — от двух разных вариантов; свободный текст — не в фильтрах', async () => {
    const { svc, prisma } = setup();
    await expect(svc.createAttribute('adm', C1, { key: 'server', label: 'Сервер', type: 'enum', options: ['EU'] })).rejects.toThrow('двух');
    await expect(svc.createAttribute('adm', C1, { key: 'server', label: 'Сервер', type: 'enum', options: ['EU', 'EU'] })).rejects.toThrow('двух');
    await svc.createAttribute('adm', C1, { key: 'nick', label: 'Ник', type: 'string', isFilter: true });
    expect(prisma.attribute.create.mock.calls[0]![0].data).toMatchObject({ isFilter: false, sortOrder: 1, editedAt: expect.any(Date) });
  });

  it('обложка — PNG, JPEG или WebP до 2 МБ; SVG нет', async () => {
    const { svc, storage } = setup();
    const png = Buffer.from('89504e47', 'hex');
    await expect(svc.setCover('adm', G, { buffer: png, mimetype: 'image/svg+xml', size: 10 })).rejects.toThrow('PNG, JPEG или WebP');
    await expect(svc.setCover('adm', G, { buffer: png, mimetype: 'image/png', size: 3 * 1024 * 1024 })).rejects.toThrow('2 МБ');
    const r = await svc.setCover('adm', G, { buffer: png, mimetype: 'image/png', size: 4 });
    expect(storage.put.mock.calls[0]![0]).toMatch(new RegExp(`^games/${G}/[0-9a-f-]+\\.png$`));
    expect(r.coverUrl).toMatch(/\/api\/assets\?key=games%2F/);
  });
});

describe('сид каталога при выкате', () => {
  /** База, в которой одна игра из справочника уже есть. */
  function db(edited: boolean) {
    const row = (extra: Record<string, unknown>) => ({ id: 'x', editedAt: edited ? new Date() : null, ...extra });
    return {
      game: {
        findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => (where.slug === 'cs2' ? row({ id: 'g-cs2', slug: 'cs2' }) : null)),
        create: vi.fn(async ({ data }: { data: { slug: string } }) => ({ id: `g-${data.slug}`, editedAt: null })),
        update: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, editedAt: null })),
      },
      category: {
        findUnique: vi.fn(async ({ where }: { where: { gameId_slug: { gameId: string } } }) =>
          where.gameId_slug.gameId === 'g-cs2' ? row({ id: 'c-cs2' }) : null,
        ),
        create: vi.fn(async () => ({ id: 'c-new', editedAt: null })),
        update: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, editedAt: null })),
      },
      attribute: {
        findUnique: vi.fn(async () => row({})),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      listing: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
  }

  it('изменённое в консоли не перезаписывается и не удаляется', async () => {
    const prisma = db(true);
    await seedCatalog(prisma as never);
    expect(prisma.game.update.mock.calls.filter((c) => c[0].where.id === 'g-cs2')).toEqual([]);
    expect(prisma.category.update.mock.calls.filter((c) => c[0].where.id === 'c-cs2')).toEqual([]);
    expect(prisma.attribute.update).not.toHaveBeenCalled();
    // Поля, которых нет в коде, удаляются только нетронутые консолью.
    for (const [arg] of prisma.attribute.deleteMany.mock.calls) expect(arg.where.editedAt).toBeNull();
  });

  it('нетронутое — обновляется из кода, как раньше', async () => {
    const prisma = db(false);
    await seedCatalog(prisma as never);
    expect(prisma.game.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'g-cs2' }, data: expect.objectContaining({ title: 'Counter-Strike 2', isActive: true }) }),
    );
    expect(prisma.attribute.update).toHaveBeenCalled();
  });
});
