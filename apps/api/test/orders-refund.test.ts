import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from '../src/modules/orders/orders.service';

/**
 * «Вернуть деньги» продавцом. Деньги лежат в эскроу, и вернуть их покупателю
 * продавец может до подтверждения: после оплаты, после выдачи и во время
 * спора. Проверяется то, что стоит денег: кто может, когда может, ровно один
 * возврат и закрытие спора.
 */

function setup(order: Record<string, unknown>) {
  const state = { order: { ...order }, disputeUpdates: [] as unknown[], sys: [] as string[] };
  const prisma = {
    order: {
      findUnique: vi.fn(async () => state.order),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.order, data)),
    },
    dispute: { updateMany: vi.fn(async (a: unknown) => state.disputeUpdates.push(a)) },
  };
  const ledger = { post: vi.fn(async () => undefined) };
  const notifications = { notify: vi.fn(async () => undefined) };
  const chat = { postSystem: vi.fn(async (_id: string, text: string) => state.sys.push(text)) };
  const svc = new OrdersService(
    prisma as never,
    ledger as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    notifications as never,
    chat as never,
  );
  return { svc, state, ledger, notifications };
}

const ORDER = { id: 'o1', buyerId: 'b1', sellerId: 's1', amount: 150_000n, currency: 'RUB', status: 'delivered' };

beforeEach(() => vi.clearAllMocks());

describe('возврат денег продавцом', () => {
  it('после выдачи продавец возвращает всю сумму на баланс покупателя', async () => {
    const { svc, state, ledger } = setup(ORDER);
    await svc.refundBySeller('o1', 's1');
    expect(state.order.status).toBe('refunded');
    expect(ledger.post).toHaveBeenCalledTimes(1);
    const arg = ledger.post.mock.calls[0]![0] as { idempotencyKey: string; refType: string; legs: unknown };
    // Тот же ключ, что у остальных возвратов: заказ не вернётся дважды разными путями
    expect(arg.idempotencyKey).toBe('refund:o1');
    expect(arg.refType).toBe('seller_refund');
  });

  it('покупатель так не может: после выдачи у него спор', async () => {
    const { svc, ledger } = setup(ORDER);
    await expect(svc.refundBySeller('o1', 'b1')).rejects.toThrow(/только продавец/);
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('завершённый заказ не возвращается: деньги уже у продавца', async () => {
    const { svc, ledger } = setup({ ...ORDER, status: 'completed' });
    await expect(svc.refundBySeller('o1', 's1')).rejects.toThrow(/уже не у площадки/);
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('неоплаченный заказ не возвращается: возвращать нечего', async () => {
    const { svc } = setup({ ...ORDER, status: 'created' });
    await expect(svc.refundBySeller('o1', 's1')).rejects.toThrow(/уже не у площадки/);
  });

  it('возврат во время спора закрывает спор в пользу покупателя', async () => {
    const { svc, state } = setup({ ...ORDER, status: 'disputed' });
    await svc.refundBySeller('o1', 's1');
    expect(state.order.status).toBe('refunded');
    expect(state.disputeUpdates[0]).toMatchObject({ data: { status: 'resolved_buyer' } });
  });

  it('причина попадает в чат без контактов', async () => {
    const { svc, state } = setup(ORDER);
    await svc.refundBySeller('o1', 's1', 'нет в наличии, пиши в телеграм @seller_tg');
    expect(state.sys[0]).toMatch(/Продавец вернул деньги/);
    expect(state.sys[0]).not.toMatch(/seller_tg|телеграм/);
  });
});
