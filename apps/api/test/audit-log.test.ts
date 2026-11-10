import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AdminService } from '../src/modules/admin/admin.service';

/**
 * Журнал действий в консоли. Раньше — последние 100–300 записей без
 * фильтров, а смена комиссии в журнал не попадала. Теперь — страницы,
 * раздел, сотрудник, история объекта, поиск по нику, почте и id; у записи —
 * о ком она: ник, сумма выплаты, номер заказа.
 */

type Sql = { text: string; values: unknown[] };
const at = (h: number) => new Date(Date.UTC(2026, 10, 4, h));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup(opts: { page?: Array<{ id: string; created_at: Date }>; people?: number } = {}) {
  const raw: Sql[] = [];
  const page = opts.page ?? [];
  const rows = page.map((p, i) => ({
    id: p.id,
    actorId: uid(900),
    action: i === 0 ? 'payout.reject' : 'dispute.resolve.buyer',
    entityType: i === 0 ? 'payout' : 'dispute',
    entityId: i === 0 ? uid(500) : uid(600),
    before: null,
    after: i === 0 ? { reason: 'Карта не на ваше имя' } : null,
    ip: null,
    createdAt: p.created_at,
  }));
  const audit: Array<Record<string, unknown>> = [];
  const prisma = {
    $queryRaw: vi.fn(async (q: Sql) => {
      raw.push(q);
      // Первый запрос поиска — кто подходит по нику или почте.
      if (q.text.includes('FROM profiles p') && !q.text.includes('audit_logs')) {
        return Array.from({ length: opts.people ?? 1 }, (_, i) => ({ id: uid(700 + i) }));
      }
      return page;
    }),
    auditLog: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        [...rows].reverse().filter((r) => where.id.in.includes(r.id)),
      ),
    },
    payout: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.includes(uid(500))
          ? [{ id: uid(500), userId: uid(800), amount: 150000n, currency: 'RUB' }]
          : [],
      ),
    },
    kycVerification: { findMany: vi.fn(async () => []) },
    dispute: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.includes(uid(600)) ? [{ id: uid(600), order: { publicNumber: 'GM-42' } }] : [],
      ),
    },
    listing: { findMany: vi.fn(async () => []) },
    profile: {
      findMany: vi.fn(async () => [
        { userId: uid(900), username: 'finance1' },
        { userId: uid(800), username: 'seller1' },
      ]),
    },
    feeRule: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'r1'
          ? {
              id: 'r1',
              scope: 'global',
              scopeRef: null,
              feeBuyerPct: 0,
              feeSellerPct: 0.07,
              feeFixed: 0n,
              currency: 'RUB',
              priority: 0,
              active: true,
            }
          : null,
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'r1',
        scope: 'global',
        scopeRef: null,
        feeBuyerPct: 0,
        feeSellerPct: 0.07,
        feeFixed: 0n,
        currency: 'RUB',
        priority: 0,
        active: true,
        ...data,
      })),
    },
  };
  const auditService = { log: vi.fn(async (e: Record<string, unknown>) => audit.push(e)) };
  const svc = new AdminService(prisma as never, auditService as never);
  return { svc, raw, audit };
}

describe('журнал действий', () => {
  it('свежие сверху; у записи — сотрудник, чья выплата и на сколько, номер заказа спора; next — с последней', async () => {
    const { svc, raw } = setup({
      page: [
        { id: uid(1), created_at: at(5) },
        { id: uid(2), created_at: at(4) },
        { id: uid(3), created_at: at(3) },
      ],
    });
    const res = await svc.auditLog({ limit: 2 });
    expect(res.items.map((r) => r.id)).toEqual([uid(1), uid(2)]); // порядок — как у базы
    expect(res.items[0]).toMatchObject({
      action: 'payout.reject',
      actor: 'finance1',
      target: { userId: uid(800), username: 'seller1', amount: '150000', currency: 'RUB' },
    });
    expect(res.items[1]!.target).toMatchObject({ number: 'GM-42', username: null });
    expect(res.next).toBe(`${at(4).toISOString()}_${uid(2)}`);
    expect(raw[0]!.text).toContain('ORDER BY a.created_at DESC, a.id DESC LIMIT');
    expect(raw[0]!.values).toContain(3);
  });

  it('раздел, сотрудник, история объекта и следующая страница — условиями одного запроса', async () => {
    const { svc, raw } = setup();
    await svc.auditLog({
      kind: 'access',
      actor: uid(900),
      entity: { type: 'user', id: uid(800) },
      cursor: { at: at(2), id: uid(2) },
    });
    const q = raw[0]!;
    expect(q.text).toContain('a.action LIKE');
    expect(q.values).toEqual(
      expect.arrayContaining([
        'role.%',
        'email.%',
        uid(900),
        'user',
        uid(800),
        at(2).toISOString(),
        uid(2),
      ]),
    );
    expect(q.text).toContain('(a.created_at, a.id) <');
  });

  it('поиск по нику: сотрудник — по его записям, о ком запись — его выплаты и проверки; «@» не мешает', async () => {
    const { svc, raw } = setup();
    await svc.auditLog({ q: ' @seller1 ' });
    expect(raw[0]!.values).toContain('%seller1%');
    const page = raw[1]!;
    expect(page.text).toContain('LATERAL');
    expect(page.text).toContain("a.entity_type = 'user'");
    expect(page.text).toContain(
      "a.entity_type = 'payout' AND a.entity_id IN (SELECT p.id::text FROM payouts p",
    );
    expect(page.text).toContain("a.entity_type = 'kyc'");
  });

  it('нашлись тысячи людей — журнал листается по времени, без захода к каждому', async () => {
    const { svc, raw } = setup({ people: 201 });
    await svc.auditLog({ q: 'e2e' });
    expect(raw[1]!.text).not.toContain('LATERAL');
    expect(raw[1]!.text).toContain('a.actor_id IN (SELECT id FROM who)');
  });

  it('поиск по id — запись, объект или сотрудник', async () => {
    const { svc, raw } = setup();
    await svc.auditLog({ q: uid(500).toUpperCase() });
    expect(raw).toHaveLength(1);
    expect(raw[0]!.text).toContain('a.entity_id =');
    expect(raw[0]!.values).toContain(uid(500));
  });

  it('смена комиссии пишется в журнал: что было и что стало; нет правила — 404', async () => {
    const { svc, audit } = setup();
    await svc.updateFeeRule(uid(900), 'r1', { feeSellerPct: 0.05 });
    expect(audit).toEqual([
      expect.objectContaining({
        actorId: uid(900),
        action: 'fee.update',
        entityType: 'fee_rule',
        entityId: 'r1',
        before: expect.objectContaining({ feeSellerPct: 0.07, feeFixed: '0' }),
        after: expect.objectContaining({ feeSellerPct: 0.05 }),
      }),
    ]);
    await expect(
      svc.updateFeeRule(uid(900), 'nope', { feeSellerPct: 0.05 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
