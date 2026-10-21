import { describe, expect, it, vi } from 'vitest';
import { DISPUTE_NOTES } from '@gamemarket/shared';
import { DisputesService } from '../src/modules/disputes/disputes.service';

/**
 * Споры: у второй стороны срок на ответ, ответ снимает его, арбитр может
 * попросить пояснений с новым сроком, пропущенный срок отмечается
 * сообщением площадки (деньги сами не двигаются), покупатель может закрыть
 * спор без претензий — сбой подтверждения возвращает спор как был.
 */

type Row = Record<string, unknown>;
const HOUR = 3600_000;

function setup() {
  const order = { id: 'o1', buyerId: 'buyer', sellerId: 'seller', status: 'disputed' };
  const disputes = new Map<string, Row>();
  const notes: Row[] = [];
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in v)
        return (v as { in: unknown[] }).in.includes(row[k]);
      if (v && typeof v === 'object' && 'not' in v) return row[k] !== (v as { not: unknown }).not;
      if (v && typeof v === 'object' && 'lt' in v)
        return !!row[k] && (row[k] as Date) < (v as { lt: Date }).lt;
      return row[k] === v;
    });
  const prisma = {
    dispute: {
      findUnique: vi.fn(async ({ where }: { where: Row }) =>
        where.id
          ? (disputes.get(where.id as string) ?? null)
          : ([...disputes.values()].find((d) => d.orderId === where.orderId) ?? null),
      ),
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        [...disputes.values()].filter((d) => matches(d, where)),
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: `d${disputes.size + 1}`,
          arbiterId: null,
          missedBy: null,
          createdAt: new Date(),
          ...data,
        };
        disputes.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) =>
        Object.assign(disputes.get(where.id as string)!, data),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = [...disputes.values()].filter((d) => matches(d, where));
        hit.forEach((d) => Object.assign(d, data));
        return { count: hit.length };
      }),
    },
    disputeMessage: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        notes.push(data);
        return { id: `m${notes.length}`, ...data };
      }),
    },
    order: { findUnique: vi.fn(async () => order) },
    userRole: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    profile: { findMany: vi.fn(async () => []) },
  };
  const orders = {
    markDisputed: vi.fn(async () => order),
    confirm: vi.fn(async () => ({ ...order, status: 'completed' })),
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const audit = { log: vi.fn(async () => undefined) };
  const svc = new DisputesService(
    prisma as never,
    orders as never,
    notifications as never,
    audit as never,
    { enabled: false } as never,
    {} as never,
  );
  return { svc, disputes, notes, orders, notifications };
}

describe('сроки ответа в споре', () => {
  it('открыл покупатель — ход за продавцом на 24 часа; его ответ снимает срок, ответ покупателя — нет', async () => {
    const { svc, disputes } = setup();
    const d = await svc.open('o1', 'buyer', 'Аккаунт не подходит');
    const row = disputes.get(d.id)!;
    expect(row.awaitingFrom).toBe('seller');
    const left = (row.respondBy as Date).getTime() - Date.now();
    expect(left).toBeGreaterThan(23.9 * HOUR);
    expect(left).toBeLessThanOrEqual(24 * HOUR);

    await svc.addMessage(d.id, 'buyer', 'Жду ответа');
    expect(row.awaitingFrom).toBe('seller');
    await svc.addMessage(d.id, 'seller', 'Данные верные, вот скриншот');
    expect(row).toMatchObject({ awaitingFrom: null, respondBy: null });
  });

  it('срок прошёл — отметка «не ответил» и сообщение площадки, один раз; деньги не двигаются', async () => {
    const { svc, disputes, notes, orders } = setup();
    const d = await svc.open('o1', 'buyer', 'Товар не выдан');
    disputes.get(d.id)!.respondBy = new Date(Date.now() - 1000);
    await svc.sweep();
    await svc.sweep();
    expect(disputes.get(d.id)).toMatchObject({
      missedBy: 'seller',
      respondBy: null,
      awaitingFrom: 'seller',
    });
    expect(notes.map((n) => n.body)).toEqual([DISPUTE_NOTES.missedSeller]);
    expect(notes[0]!.senderId).toBeNull();
    expect(orders.confirm).not.toHaveBeenCalled();
  });

  it('арбитр просит пояснений у покупателя: новый срок, сообщение и уведомление ему', async () => {
    const { svc, disputes, notes, notifications } = setup();
    const d = await svc.open('o1', 'buyer', 'Не тот ранг');
    await svc.request(d.id, 'arb', 'buyer');
    expect(disputes.get(d.id)).toMatchObject({
      awaitingFrom: 'buyer',
      status: 'in_review',
      arbiterId: 'arb',
    });
    expect(notes.at(-1)!.body).toBe(DISPUTE_NOTES.askBuyer);
    expect(notifications.notify).toHaveBeenCalledWith(
      'buyer',
      'dispute_reply_needed',
      expect.objectContaining({ disputeId: d.id }),
    );
  });
});

describe('покупатель закрывает спор сам', () => {
  it('претензий нет — подтверждение заказа, спор закрыт, сообщение; повтор — отказ', async () => {
    const { svc, disputes, notes, orders } = setup();
    const d = await svc.open('o1', 'buyer', 'Долго нет ответа');
    await expect(svc.withdraw(d.id, 'seller')).rejects.toThrow(/только покупатель/);
    expect(await svc.withdraw(d.id, 'buyer')).toEqual({ ok: true });
    expect(orders.confirm).toHaveBeenCalledWith('o1', 'buyer');
    expect(disputes.get(d.id)).toMatchObject({ status: 'cancelled', awaitingFrom: null });
    expect(notes.at(-1)!.body).toBe(DISPUTE_NOTES.withdrawn);
    await expect(svc.withdraw(d.id, 'buyer')).rejects.toThrow(/уже разрешён/);
    expect(orders.confirm).toHaveBeenCalledTimes(1);
  });

  it('подтверждение не прошло — спор остаётся открытым, со сроком', async () => {
    const { svc, disputes, orders } = setup();
    const d = await svc.open('o1', 'buyer', 'Не пришло');
    orders.confirm.mockRejectedValueOnce(new Error('сбой базы'));
    await expect(svc.withdraw(d.id, 'buyer')).rejects.toThrow('сбой базы');
    expect(disputes.get(d.id)).toMatchObject({ status: 'open', awaitingFrom: 'seller' });
  });
});
