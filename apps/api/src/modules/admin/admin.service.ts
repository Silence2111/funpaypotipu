import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient, type FeeScope } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { AuditService } from '../access/audit.service';

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
  listFeeRules() {
    return this.prisma.feeRule.findMany({ orderBy: [{ scope: 'asc' }, { priority: 'desc' }] });
  }

  createFeeRule(input: FeeRuleInput) {
    return this.prisma.feeRule.create({
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
  }

  async updateFeeRule(id: string, input: Partial<FeeRuleInput>) {
    const data: Prisma.FeeRuleUpdateInput = {};
    if (input.feeBuyerPct !== undefined) data.feeBuyerPct = input.feeBuyerPct;
    if (input.feeSellerPct !== undefined) data.feeSellerPct = input.feeSellerPct;
    if (input.feeFixed !== undefined) data.feeFixed = BigInt(input.feeFixed);
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.active !== undefined) data.active = input.active;
    return this.prisma.feeRule.update({ where: { id }, data });
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
    const role = await this.prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) throw new NotFoundException('Роль не найдена');
    await this.prisma.userRole.deleteMany({ where: { userId, roleId: role.id } });
    await this.audit.log({ actorId, action: 'role.revoke', entityType: 'user', entityId: userId, after: { roleKey } });
    return { ok: true };
  }

  // ── Пользователи ──
  listUsers(limit = 100) {
    return this.prisma.user.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        profile: { select: { username: true, ratingAvg: true, salesCount: true } },
        roles: { select: { role: { select: { key: true } } } },
      },
    });
  }
}
