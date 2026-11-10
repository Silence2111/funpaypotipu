import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient, type FeeScope } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { AuditService } from '../access/audit.service';
import { likeText } from '../../common/like';
import { nextCursor } from '../../common/cursor';

export const DISPLAY_RATES_KEY = 'display_rates';

/**
 * Разделы журнала — по началу ключа действия. Записи пишут разные модули
 * (`payout.approve`, `kyc.reject`, `recovery.restore`…), отдельного поля
 * «раздел» у записи нет.
 */
export const AUDIT_KINDS = {
  payouts: ['payout.'],
  moderation: ['moderation.', 'report.'],
  disputes: ['dispute.'],
  kyc: ['kyc.'],
  recovery: ['recovery.'],
  access: ['role.', 'email.'],
  settings: ['rates.', 'fee.', 'partner.'],
  catalog: ['catalog.'],
} as const;
export type AuditKind = keyof typeof AUDIT_KINDS;
export const AUDIT_KIND_KEYS = Object.keys(AUDIT_KINDS) as [AuditKind, ...AuditKind[]];

/** Страница журнала: какой раздел, чьи действия, над чем, что искать, откуда продолжать. */
export interface AuditQuery {
  kind?: AuditKind;
  /** Действия одного сотрудника. */
  actor?: string;
  /** История одного объекта: выплаты, спора, пользователя… */
  entity?: { type: string; id: string };
  q?: string;
  cursor?: { at: Date; id: string };
  limit?: number;
}

/** Сколько найденных поиском людей журнал проверяет по одному. */
const FEW_PEOPLE = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Что было и стало в правиле комиссии — для журнала. */
const feeSnapshot = (r: {
  scope: FeeScope;
  scopeRef: string | null;
  feeBuyerPct: number;
  feeSellerPct: number;
  feeFixed: bigint;
  currency: string;
  priority: number;
  active: boolean;
}) => ({
  scope: r.scope,
  scopeRef: r.scopeRef,
  feeBuyerPct: r.feeBuyerPct,
  feeSellerPct: r.feeSellerPct,
  feeFixed: r.feeFixed.toString(),
  currency: r.currency,
  priority: r.priority,
  active: r.active,
});

export interface FeeRuleInput {
  scope: FeeScope;
  scopeRef?: string | null;
  feeBuyerPct: number;
  feeSellerPct: number;
  feeFixed?: number;
  currency: string;
  priority?: number;
  active?: boolean;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  // ── Комиссии ──
  /** Правила с названием раздела: в scopeRef лежит id категории, по нему правило не узнать. */
  async listFeeRules() {
    const rules = await this.prisma.feeRule.findMany({ orderBy: [{ scope: 'asc' }, { priority: 'desc' }] });
    const categoryIds = rules.filter((r) => r.scope === 'category' && r.scopeRef).map((r) => r.scopeRef!);
    const categories = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, title: true, game: { select: { title: true } } },
    });
    const title = new Map(categories.map((c) => [c.id, c.game ? `${c.game.title} · ${c.title}` : c.title]));
    return rules.map((r) => ({ ...r, scopeTitle: r.scopeRef ? title.get(r.scopeRef) ?? null : null }));
  }

  /** Комиссия — это деньги: кто и когда её поменял, видно в журнале. */
  async createFeeRule(actorId: string, input: FeeRuleInput) {
    const rule = await this.prisma.feeRule.create({
      data: {
        scope: input.scope,
        scopeRef: input.scopeRef ?? null,
        feeBuyerPct: input.feeBuyerPct,
        feeSellerPct: input.feeSellerPct,
        feeFixed: BigInt(input.feeFixed ?? 0),
        currency: input.currency,
        priority: input.priority ?? 0,
        active: input.active ?? true,
      },
    });
    await this.audit.log({ actorId, action: 'fee.create', entityType: 'fee_rule', entityId: rule.id, after: feeSnapshot(rule) });
    return rule;
  }

  async updateFeeRule(actorId: string, id: string, input: Partial<FeeRuleInput>) {
    const before = await this.prisma.feeRule.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Правило не найдено');
    const data: Prisma.FeeRuleUpdateInput = {};
    if (input.feeBuyerPct !== undefined) data.feeBuyerPct = input.feeBuyerPct;
    if (input.feeSellerPct !== undefined) data.feeSellerPct = input.feeSellerPct;
    if (input.feeFixed !== undefined) data.feeFixed = BigInt(input.feeFixed);
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.active !== undefined) data.active = input.active;
    const rule = await this.prisma.feeRule.update({ where: { id }, data });
    await this.audit.log({
      actorId,
      action: 'fee.update',
      entityType: 'fee_rule',
      entityId: id,
      before: feeSnapshot(before),
      after: feeSnapshot(rule),
    });
    return rule;
  }

  // ── Роли ──
  async assignRole(actorId: string, userId: string, roleKey: string) {
    const role = await this.prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) throw new NotFoundException('Роль не найдена');
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    });
    await this.audit.log({ actorId, action: 'role.assign', entityType: 'user', entityId: userId, after: { roleKey } });
    return { ok: true };
  }

  async revokeRole(actorId: string, userId: string, roleKey: string) {
    // Последний администратор не должен случайно запереть консоль от всех.
    if (roleKey === 'admin' && actorId === userId) {
      throw new BadRequestException('Свою роль администратора снять нельзя — попросите другого администратора');
    }
    const role = await this.prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) throw new NotFoundException('Роль не найдена');
    await this.prisma.userRole.deleteMany({ where: { userId, roleId: role.id } });
    await this.audit.log({ actorId, action: 'role.revoke', entityType: 'user', entityId: userId, after: { roleKey } });
    return { ok: true };
  }

  // ── Курсы для показа цен ──
  /**
   * Сколько рублей в долларе и евро — только для показа «≈ 10,84 $» рядом с
   * ценой. Оплата всегда в рублях, поэтому курс задаёт площадка, а не биржа.
   */
  async setDisplayRates(actorId: string, rates: { USD: number; EUR: number }) {
    const value = { USD: rates.USD, EUR: rates.EUR, setBy: actorId, setAt: new Date().toISOString() };
    await this.prisma.systemSetting.upsert({
      where: { key: DISPLAY_RATES_KEY },
      update: { value },
      create: { key: DISPLAY_RATES_KEY, value },
    });
    await this.audit.log({ actorId, action: 'rates.set', entityType: 'setting', entityId: DISPLAY_RATES_KEY, after: value });
    return value;
  }

  listRoles() {
    return this.prisma.role.findMany({ orderBy: { key: 'asc' }, select: { key: true, description: true } });
  }

  // ── Журнал ──
  /**
   * Журнал значимых действий — деньги, модерация, права: кто, что, над чем и
   * когда. По 50 и «Показать ещё», свежие сверху; раздел, сотрудник, история
   * одного объекта; поиск по нику и почте — сотрудника или того, о ком
   * запись (его выплаты и проверки личности тоже), или по id. Раньше
   * отдавались последние 100–300 записей без фильтров.
   */
  async auditLog(q: AuditQuery = {}) {
    const limit = q.limit ?? 50;
    const text = q.q?.trim().replace(/^[#@]+/, '');
    const filters: Prisma.Sql[] = [];
    if (q.kind) {
      filters.push(Prisma.sql`(${Prisma.join(AUDIT_KINDS[q.kind].map((p) => Prisma.sql`a.action LIKE ${`${p}%`}`), ' OR ')})`);
    }
    if (q.actor) filters.push(Prisma.sql`a.actor_id = ${q.actor}::uuid`);
    if (q.entity) filters.push(Prisma.sql`a.entity_type = ${q.entity.type} AND a.entity_id = ${q.entity.id}`);
    const c = q.cursor;
    // Время в базе — UTC без пояса.
    if (c) {
      filters.push(Prisma.sql`(a.created_at, a.id) < ((${c.at.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${c.id}::uuid)`);
    }
    // Каждая ветка поиска — по своему индексу и не длиннее страницы, дальше
    // ветки сливаются: условие через OR индексы не берёт и листает весь журнал.
    const branch = (match: Prisma.Sql) =>
      Prisma.sql`(SELECT a.id, a.created_at FROM audit_logs a WHERE ${Prisma.join([match, ...filters], ' AND ')}
        ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit + 1})`;
    let sql: Prisma.Sql;
    if (!text) {
      sql = branch(Prisma.sql`TRUE`);
    } else if (UUID.test(text)) {
      const id = text.toLowerCase();
      sql = Prisma.sql`SELECT * FROM (${Prisma.join(
        [
          branch(Prisma.sql`a.entity_id = ${id}`),
          branch(Prisma.sql`a.actor_id = ${id}::uuid`),
          branch(Prisma.sql`a.id = ${id}::uuid`),
        ],
        ' UNION ',
      )}) x ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`;
    } else {
      const like = `%${likeText(text)}%`;
      const people = Prisma.sql`SELECT p.user_id AS id FROM profiles p WHERE p.username ILIKE ${like}
        UNION SELECT u.id FROM users u WHERE u.email ILIKE ${like}`;
      const found = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`${people} LIMIT ${FEW_PEOPLE + 1}`);
      // Нашлось немного людей — для каждого сотрудника берём его записи по
      // его индексу: через «IN» база листает журнал по времени и, если
      // записей нет, проходит его весь. Нашлись тысячи — наоборот: записи
      // попадаются часто, листать по времени быстрее, чем тысячи заходов.
      const few = found.length <= FEW_PEOPLE;
      const who = few ? Prisma.sql`SELECT unnest(${found.map((f) => f.id)}::uuid[]) AS id` : people;
      sql = Prisma.sql`WITH who AS MATERIALIZED (${who})
        SELECT * FROM (${Prisma.join(
          [
            few
              ? Prisma.sql`(SELECT t.id, t.created_at FROM who, LATERAL (SELECT a.id, a.created_at FROM audit_logs a
                  WHERE ${Prisma.join([Prisma.sql`a.actor_id = who.id`, ...filters], ' AND ')}
                  ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit + 1}) t)`
              : branch(Prisma.sql`a.actor_id IN (SELECT id FROM who)`),
            branch(Prisma.sql`a.entity_type = 'user' AND a.entity_id IN (SELECT id::text FROM who)`),
            branch(
              Prisma.sql`a.entity_type = 'payout' AND a.entity_id IN (SELECT p.id::text FROM payouts p WHERE p.user_id IN (SELECT id FROM who))`,
            ),
            branch(
              Prisma.sql`a.entity_type = 'kyc' AND a.entity_id IN (SELECT k.id::text FROM kyc_verifications k WHERE k.user_id IN (SELECT id FROM who))`,
            ),
          ],
          ' UNION ',
        )}) x ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`;
    }
    const page = await this.prisma.$queryRaw<Array<{ id: string; created_at: Date }>>(sql);
    const ids = page.slice(0, limit).map((r) => r.id);
    const place = new Map(ids.map((id, i) => [id, i]));
    const rows = (await this.prisma.auditLog.findMany({ where: { id: { in: ids } } })).sort(
      (a, b) => place.get(a.id)! - place.get(b.id)!,
    );

    // О ком или о чём запись — ник, сумма, номер заказа вместо голого id.
    const of = (type: string) => [
      ...new Set(rows.filter((r) => r.entityType === type && UUID.test(r.entityId)).map((r) => r.entityId)),
    ];
    const [payouts, kycs, disputes, listings] = await Promise.all([
      this.prisma.payout.findMany({
        where: { id: { in: of('payout') } },
        select: { id: true, userId: true, amount: true, currency: true },
      }),
      this.prisma.kycVerification.findMany({ where: { id: { in: of('kyc') } }, select: { id: true, userId: true } }),
      this.prisma.dispute.findMany({
        where: { id: { in: of('dispute') } },
        select: { id: true, order: { select: { publicNumber: true } } },
      }),
      this.prisma.listing.findMany({ where: { id: { in: of('listing') } }, select: { id: true, title: true } }),
    ]);
    const payout = new Map(payouts.map((p) => [p.id, p]));
    const kyc = new Map(kycs.map((k) => [k.id, k.userId]));
    const dispute = new Map(disputes.map((d) => [d.id, d.order?.publicNumber ?? null]));
    const listing = new Map(listings.map((l) => [l.id, l.title]));
    const people = [
      ...rows.map((r) => r.actorId),
      ...of('user'),
      ...payouts.map((p) => p.userId),
      ...kycs.map((k) => k.userId),
    ].filter((v): v is string => !!v);
    const profiles = await this.prisma.profile.findMany({
      where: { userId: { in: [...new Set(people)] } },
      select: { userId: true, username: true },
    });
    const name = new Map(profiles.map((p) => [p.userId, p.username]));
    const target = (r: (typeof rows)[number]) => {
      const owner =
        r.entityType === 'user'
          ? r.entityId
          : r.entityType === 'payout'
            ? payout.get(r.entityId)?.userId
            : r.entityType === 'kyc'
              ? kyc.get(r.entityId)
              : undefined;
      const p = r.entityType === 'payout' ? payout.get(r.entityId) : undefined;
      return {
        userId: owner ?? null,
        username: owner ? name.get(owner) ?? null : null,
        amount: p ? p.amount.toString() : null,
        currency: p?.currency ?? null,
        number: dispute.get(r.entityId) ?? null,
        title: listing.get(r.entityId) ?? null,
      };
    };
    const items = rows.map((r) => ({
      ...r,
      actor: r.actorId ? name.get(r.actorId) ?? null : null,
      target: target(r),
    }));
    const last = page[ids.length - 1];
    return { items, next: page.length > limit && last ? nextCursor(last.created_at, last.id) : null };
  }
}
