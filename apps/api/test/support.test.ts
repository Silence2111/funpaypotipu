import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportService } from '../src/modules/support/support.service';

/**
 * Обращения в поддержку. Статус показывает, чей ход; чужое обращение не
 * читается; заказ в обращении — только свой; ответ поддержки доходит
 * уведомлением.
 */

function setup(opts: { ticket?: Record<string, unknown>; staff?: boolean; open?: number; order?: Record<string, unknown> | null } = {}) {
  const state = { ticket: { id: 't1', userId: 'u1', status: 'open', assigneeId: null, ...(opts.ticket ?? {}) } as Record<string, unknown> };
  const prisma = {
    order: { findUnique: vi.fn(async () => (opts.order === undefined ? { buyerId: 'u1', sellerId: 's1' } : opts.order)) },
    supportTicket: {
      count: vi.fn(async () => opts.open ?? 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 't-new', ...data })),
      findUnique: vi.fn(async () => state.ticket),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.ticket, data)),
    },
    supportMessage: { create: vi.fn(async () => ({})) },
    userRole: { count: vi.fn(async () => (opts.staff ? 1 : 0)) },
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  return { svc: new SupportService(prisma as never, notifications as never), state, prisma, notifications };
}

beforeEach(() => vi.clearAllMocks());

describe('обращение', () => {
  it('заказ в обращении — только свой', async () => {
    const { svc } = setup({ order: { buyerId: 'other', sellerId: 'other2' } });
    await expect(
      svc.create('u1', { subject: 'Не пришёл ключ', category: 'order', orderId: 'o1', body: 'Оплатил, ключа нет уже час' }),
    ).rejects.toThrow(/Заказ не найден/);
  });

  it('больше пяти открытых обращений — нельзя', async () => {
    const { svc } = setup({ open: 5 });
    await expect(svc.create('u1', { subject: 'Вопрос', category: 'other', body: 'Ещё один вопрос по сайту' })).rejects.toThrow(/пять/);
  });

  it('чужое обращение не читается', async () => {
    const { svc } = setup();
    await expect(svc.reply('t1', 'stranger', 'привет')).rejects.toThrow(/не ваше/);
  });
});

describe('переписка', () => {
  it('ответ поддержки: ход пользователя, он получает уведомление, сотрудник закреплён', async () => {
    const { svc, state, prisma, notifications } = setup({ staff: true });
    await svc.reply('t1', 'agent', 'Проверили: ключ выдан повторно.');
    expect(state.ticket).toMatchObject({ status: 'answered', assigneeId: 'agent' });
    expect(prisma.supportMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fromStaff: true }) });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'support_reply', { ticketId: 't1' });
  });

  it('ответ пользователя — снова ход поддержки, даже если обращение закрыто', async () => {
    const { svc, state, notifications } = setup({ ticket: { status: 'closed' } });
    await svc.reply('t1', 'u1', 'Ключ снова не работает');
    expect(state.ticket.status).toBe('open');
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
