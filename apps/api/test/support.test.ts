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

describe('очередь поддержки', () => {
  type Sql = { text: string; values: unknown[] };
  const at = (h: number) => new Date(Date.UTC(2026, 9, 31, h));
  const ticket = (id: string, h: number) => ({
    id, userId: 'u1', assigneeId: null, subject: `Вопрос ${id}`, category: 'other', status: 'open',
    lastMessageAt: at(h), _count: { messages: 2 },
  });

  function queueSetup(page: string[], counts: Array<{ status: string; n: number }>) {
    const raw: Sql[] = [];
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
      $queryRaw: vi.fn(async (q: Sql | TemplateStringsArray) => {
        // Настройка плана поиска — шаблоном, сами запросы — Prisma.sql.
        if (!('text' in q)) return [];
        raw.push(q);
        return q.text.includes('count(*)') ? counts : page.map((id) => ({ id }));
      }),
      // Порядок из базы — не тот, что у страницы: собирается по id.
      supportTicket: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          [ticket('t1', 1), ticket('t3', 3), ticket('t2', 2)].filter((t) => where.id.in.includes(t.id)),
        ),
      },
      profile: { findMany: vi.fn(async () => [{ userId: 'u1', username: 'buyer1' }]) },
    };
    const svc = new SupportService(prisma as never, {} as never);
    const sql = (needle: string) => raw.find((q) => q.text.includes(needle))!;
    return { svc, sql, prisma };
  }

  it('ждущие — старые сверху, по страницам; next — с последнего показанного; закрытые без поиска не считаются', async () => {
    const { svc, sql, prisma } = queueSetup(['t1', 't2', 't3'], [{ status: 'open', n: 260 }, { status: 'answered', n: 4 }]);
    const res = await svc.queue({ status: 'open', limit: 2 });
    expect(res.items.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(res.items[0]).toMatchObject({ user: 'buyer1', messages: 2 });
    expect(res.next).toBe(`${at(2).toISOString()}_t2`);
    expect(res.counts).toEqual({ open: 260, answered: 4, closed: null });
    const page = sql('LIMIT');
    expect(page.text).toContain('ORDER BY t.last_message_at ASC, t.id ASC');
    expect(page.values).toEqual(expect.arrayContaining(['open', 3]));
    expect(sql('count(*)').text).toContain("t.status IN ('open', 'answered')");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('закрытые — свежие сверху, курсор — раньше последнего показанного; последняя страница — без next', async () => {
    const { svc, sql } = queueSetup(['t3'], []);
    const res = await svc.queue({ status: 'closed', cursor: { at: at(4), id: '00000000-0000-4000-8000-000000000004' } });
    expect(res.next).toBeNull();
    const page = sql('LIMIT');
    expect(page.text).toContain('ORDER BY t.last_message_at DESC, t.id DESC');
    expect(page.text).toContain('(t.last_message_at, t.id) <');
    expect(page.values).toEqual(expect.arrayContaining([at(4).toISOString(), '00000000-0000-4000-8000-000000000004']));
  });

  it('поиск — тема, ник автора, номер заказа; «#» впереди не мешает, «%» и «_» — обычные знаки; закрытые посчитаны', async () => {
    const { svc, sql, prisma } = queueSetup(['t1'], [{ status: 'closed', n: 7 }]);
    const res = await svc.queue({ status: 'closed', q: ' #GM-1%_ ' });
    expect(res.counts).toEqual({ open: 0, answered: 0, closed: 7 });
    const page = sql('LIMIT');
    expect(page.text).toContain('t.subject ILIKE');
    expect(page.text).toContain('p.username ILIKE');
    expect(page.text).toContain('o.public_number ILIKE');
    expect(page.values).toContain('%GM-1\\%\\_%');
    expect(sql('count(*)').text).not.toContain("IN ('open', 'answered')");
    // план под текст поиска — в своей транзакции; без поиска её нет
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
