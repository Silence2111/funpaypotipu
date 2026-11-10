import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeFees } from '@gamemarket/shared';
import { ListingsService } from '../src/modules/listings/listings.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { EncryptionService } from '../src/modules/crypto/encryption.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { ChatService } from '../src/modules/chat/chat.service';

/**
 * Автовыдача любых товаров. Раньше сразу после оплаты выдавались только
 * ключи; аккаунты и предметы продавец передавал руками — на FunPay для этого
 * ставят бота. Теперь у лота любого раздела может быть склад строк, а у
 * любого лота — сообщение покупателю после оплаты.
 *
 * Проверяется: кому автовыдача доступна, что происходит с наличием при
 * включении и выключении, повторы на складе и порядок сообщений в чате.
 * Prisma и соседние сервисы подменены.
 */

beforeEach(() => vi.clearAllMocks());

function listings(
  opts: { current?: Record<string, unknown>; pack?: boolean; lines?: number } = {},
) {
  const calls = {
    create: [] as Array<{ data: Record<string, unknown> }>,
    update: [] as Array<{ data: Record<string, unknown> }>,
  };
  const category = {
    id: 'c1',
    fulfillmentType: 'manual',
    unitName: opts.pack ? 'золота' : null,
    pricePerUnits: opts.pack ? 1000 : null,
  };
  const prisma = {
    category: { findFirst: vi.fn(async () => category) },
    attribute: { findMany: vi.fn(async () => []) },
    digitalGood: { count: vi.fn(async () => opts.lines ?? 0) },
    listing: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        calls.create.push(a);
        return { id: 'l1', ...a.data };
      }),
      findUnique: vi.fn(async () => (opts.current ? { category, ...opts.current } : null)),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => {
        calls.update.push(a);
        return { id: 'l1', ...a.data };
      }),
    },
  };
  const search = { indexListing: vi.fn(async () => {}) };
  return {
    svc: new ListingsService(prisma as never, search as never, {} as never, {} as never),
    calls,
    prisma,
  };
}

const NEW = {
  gameId: 'g1',
  categoryId: 'c1',
  title: 'Аккаунт Genshin, AR 55',
  description: 'Почта в комплекте',
  price: '99000',
  currency: 'RUB' as const,
  attributes: {},
  images: [],
  topup: null,
  stock: null,
};

const MINE = {
  sellerId: 's1',
  status: 'active',
  categoryId: 'c1',
  fulfillmentType: 'manual',
  topupMarkupBps: null,
  unitName: null,
  pricePerUnits: 1,
  minQty: 1,
  stock: null,
};

describe('автовыдача у аккаунтов и предметов', () => {
  it('продавец включает её при создании: склад строк, по строке за штуку, без склада — не в каталоге', async () => {
    const { svc, calls } = listings();
    await svc.create('s1', { ...NEW, autoDelivery: true, stock: 7 });
    expect(calls.create[0]!.data).toMatchObject({
      fulfillmentType: 'auto_key',
      autoDelivery: true,
      unitName: null,
      pricePerUnits: 1,
      minQty: 1,
      stock: 0,
      status: 'sold_out',
    });
  });

  it('без выбора лот, как раньше, выдаёт продавец', async () => {
    const { svc, calls } = listings();
    await svc.create('s1', NEW);
    expect(calls.create[0]!.data).toMatchObject({
      fulfillmentType: 'manual',
      autoDelivery: false,
      status: 'active',
    });
  });

  it('у валюты с общей пачкой склада строк нет — её продают количеством', async () => {
    const { svc, calls } = listings({ pack: true });
    await expect(
      svc.create('s1', {
        ...NEW,
        autoDelivery: true,
        unitName: 'золота',
        pricePerUnits: 1000,
        stock: 5000,
      }),
    ).rejects.toThrow(/количеством/);
    expect(calls.create).toHaveLength(0);
  });

  it('со склада ник и сервер не спрашивают — отвечать некому', async () => {
    const { svc } = listings();
    await expect(
      svc.create('s1', {
        ...NEW,
        autoDelivery: true,
        buyerFields: [{ label: 'Ник в игре', required: true }],
      }),
    ).rejects.toThrow(/ручной выдачей/);
  });

  it('включили у выставленного лота: наличие — то, что уже на складе', async () => {
    const { svc, calls, prisma } = listings({
      current: { ...MINE, buyerFields: [{ label: 'Ник', required: true }] },
      lines: 3,
    });
    await svc.update('s1', 'l1', { autoDelivery: true });
    expect(prisma.digitalGood.count).toHaveBeenCalledWith({
      where: { listingId: 'l1', status: 'available' },
    });
    expect(calls.update[0]!.data).toMatchObject({
      fulfillmentType: 'auto_key',
      autoDelivery: true,
      stock: 3,
    });
    expect(calls.update[0]!.data.status).toBeUndefined();
  });

  it('включили, а склад пуст — лот уходит из каталога до первой загрузки', async () => {
    const { svc, calls } = listings({ current: MINE, lines: 0 });
    await svc.update('s1', 'l1', { autoDelivery: true });
    expect(calls.update[0]!.data).toMatchObject({ stock: 0, status: 'sold_out' });
  });

  it('выключили: лот снова выдаёт продавец, без ограничения наличия, и возвращается в продажу', async () => {
    const { svc, calls } = listings({
      current: { ...MINE, status: 'sold_out', fulfillmentType: 'auto_key', stock: 0 },
    });
    await svc.update('s1', 'l1', { autoDelivery: false });
    expect(calls.update[0]!.data).toMatchObject({
      fulfillmentType: 'manual',
      autoDelivery: false,
      stock: null,
      status: 'active',
    });
  });

  it('правка без выбора способ выдачи не меняет', async () => {
    const { svc, calls } = listings({
      current: { ...MINE, fulfillmentType: 'auto_key', stock: 4 },
    });
    await svc.update('s1', 'l1', { title: 'Аккаунт Genshin, AR 56' });
    expect(calls.update[0]!.data.fulfillmentType).toBeUndefined();
    expect(calls.update[0]!.data.stock).toBeUndefined();
  });
});

describe('сообщение покупателю после оплаты', () => {
  it('сохраняется с лотом, контакты скрыты сразу — продавец видит то же, что покупатель', async () => {
    const { svc, calls } = listings();
    await svc.create('s1', {
      ...NEW,
      deliveryTemplate: '  Войдите и смените пароль. Вопросы — в тг @seller_pro  ',
    });
    expect(calls.create[0]!.data.deliveryTemplate).toBe(
      'Войдите и смените пароль. Вопросы — в [скрыто] [скрыто]',
    );
  });

  it('пустое сообщение снимается', async () => {
    const { svc, calls } = listings({ current: MINE });
    await svc.update('s1', 'l1', { deliveryTemplate: '   ' });
    expect(calls.update[0]!.data.deliveryTemplate).toBeNull();
  });
});

describe('склад строк', () => {
  function inventory(stored: string[]) {
    const encryption = new EncryptionService();
    const created: string[] = [];
    const prisma = {
      listing: {
        findUnique: vi.fn(async () => ({
          id: 'l1',
          sellerId: 's1',
          status: 'sold_out',
          fulfillmentType: 'auto_key',
        })),
        update: vi.fn(async (a: unknown) => a),
      },
      digitalGood: {
        findMany: vi.fn(async () => stored.map((s) => ({ payloadEnc: encryption.encrypt(s) }))),
        createMany: vi.fn(async ({ data }: { data: Array<{ payloadEnc: string }> }) => {
          created.push(...data.map((d) => encryption.decrypt(d.payloadEnc)));
          return { count: data.length };
        }),
      },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    return { svc: new InventoryService(prisma as never, encryption), prisma, created };
  }

  it('одна строка дважды не ложится: иначе один аккаунт уйдёт двум покупателям', async () => {
    const { svc, created, prisma } = inventory(['mail1@x.ru:pass1']);
    const r = await svc.addKeys('s1', 'l1', [
      'mail1@x.ru:pass1',
      'mail2@x.ru:pass2',
      ' mail2@x.ru:pass2 ',
      'mail3@x.ru:pass3',
    ]);
    expect(r).toEqual({ added: 2, skipped: 2 });
    expect(created).toEqual(['mail2@x.ru:pass2', 'mail3@x.ru:pass3']);
    expect(prisma.listing.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { stock: { increment: 2 }, status: 'active' },
    });
  });

  it('всё уже на складе — склад и лот не трогаются', async () => {
    const { svc, prisma } = inventory(['KEY-1']);
    expect(await svc.addKeys('s1', 'l1', ['KEY-1'])).toEqual({ added: 0, skipped: 1 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('чат заказа после оплаты', () => {
  function paying(opts: {
    fulfillmentType: string;
    template: string | null;
    goods?: string;
    outcome?: 'delivered' | 'refunded';
  }) {
    const said: string[] = [];
    const state = {
      order: {
        id: 'o1',
        publicNumber: 'GM-TEST',
        buyerId: 'buyer',
        sellerId: 'seller',
        listingId: 'l1',
        status: 'created',
        fulfillmentType: opts.fulfillmentType,
        qty: 1,
        amount: 99_000n,
        currency: 'RUB',
        feeBuyer: 0n,
        feeSeller: 9_900n,
        sellerPayoutAmount: 89_100n,
        listingSnapshot: { title: 'Аккаунт', ...(opts.goods ? { goods: opts.goods } : {}) },
      } as Record<string, unknown>,
    };
    const prisma = {
      listing: {
        findUnique: vi.fn(async () => ({
          stock: null,
          fulfillmentType: opts.fulfillmentType,
          deliveryTemplate: opts.template,
        })),
      },
      order: {
        findUnique: vi.fn(async () => state.order),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(state.order, data);
          return { count: 1 };
        }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    const fulfillment = {
      autoFulfill: vi.fn(async () => {
        state.order.status = opts.outcome ?? 'delivered';
      }),
    };
    const chat = {
      postSystem: vi.fn(async (_id: string, text: string) => said.push(`площадка: ${text}`)),
      postFromSeller: vi.fn(async (_id: string, text: string) => said.push(`продавец: ${text}`)),
    };
    const svc = new OrdersService(
      prisma as never,
      {
        post: vi.fn(),
        balanceOf: vi.fn(async () => 1_000_000n),
        assertNotOverdrawn: vi.fn(),
      } as never,
      { computeForCategory: vi.fn(async (b: bigint) => computeFees(b, 0, 0.1)) } as never,
      fulfillment as never,
      {} as never,
      {} as never,
      { notify: vi.fn(async () => undefined) } as never,
      chat as never,
    );
    return { svc, said };
  }

  it('автовыдача: оплата, выдача, затем инструкция продавца от его имени', async () => {
    const { svc, said } = paying({
      fulfillmentType: 'auto_key',
      goods: 'item',
      template: 'Смените пароль после входа.',
    });
    await svc.payFromBalance('o1', 'buyer');
    expect(said).toEqual([
      'площадка: Оплата поступила — средства защищены эскроу.',
      'площадка: Товар выдан автоматически — он на странице заказа. Проверьте его и подтвердите получение.',
      'продавец: Смените пароль после входа.',
    ]);
  });

  it('у ключей прежние слова — «заберите ключ»', async () => {
    const { svc, said } = paying({ fulfillmentType: 'auto_key', template: null });
    await svc.payFromBalance('o1', 'buyer');
    expect(said.at(-1)).toBe(
      'площадка: Товар выдан автоматически. Заберите ключ на странице заказа.',
    );
  });

  it('ручная выдача: сообщение продавца сразу после оплаты', async () => {
    const { svc, said } = paying({
      fulfillmentType: 'manual',
      template: 'Выдам за 15 минут, будьте в сети.',
    });
    await svc.payFromBalance('o1', 'buyer');
    expect(said).toEqual([
      'площадка: Оплата поступила — средства защищены эскроу.',
      'продавец: Выдам за 15 минут, будьте в сети.',
    ]);
  });

  it('склад кончился и деньги вернулись — инструкции к несуществующему товару нет', async () => {
    const { svc, said } = paying({
      fulfillmentType: 'auto_key',
      goods: 'item',
      template: 'Смените пароль.',
      outcome: 'refunded',
    });
    await svc.payFromBalance('o1', 'buyer');
    expect(said.some((s) => s.startsWith('продавец:'))).toBe(false);
  });
});

describe('сообщение от имени продавца', () => {
  it('в чат заказа, автор — продавец, контакты скрыты', async () => {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      conversation: {
        findUnique: vi.fn(async () => ({ id: 'cv1', buyerId: 'buyer', sellerId: 'seller' })),
        update: vi.fn(async () => ({})),
      },
      message: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: 'm1', createdAt: new Date(), ...data };
        }),
      },
    };
    const chat = new ChatService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const published: Array<{ senderId: string | null; body: string }> = [];
    chat.setPublisher((_c, m) => published.push(m));
    await chat.postFromSeller('o1', 'Пишите в whatsapp +7 999 123-45-67');
    expect(created[0]).toMatchObject({ senderId: 'seller', type: 'text', isFlagged: true });
    expect(published[0]).toMatchObject({ senderId: 'seller', body: 'Пишите в [скрыто] [скрыто]' });
  });
});
