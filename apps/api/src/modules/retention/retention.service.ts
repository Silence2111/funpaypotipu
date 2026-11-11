import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, PrismaClient } from '@gamemarket/db';
import {
  ERASURE_CATEGORIES,
  ERASURE_METHOD,
  ERASURE_REASONS,
  ERASURE_SYSTEM,
  actCutoff,
  chatCutoff,
  dealCutoff,
  erasedUsername,
  type ErasureReason,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { StorageService } from '../storage/storage.service';
import { utc } from '../../common/sql-time';

/** Проход сроков хранения: раз в 6 часов; в e2e — раз в 2 с. */
const SWEEP_MS = Number(process.env.RETENTION_SWEEP_MS ?? 6 * 3600_000);
const BATCH = 200;
const MSK_MS = 3 * 3600_000;

type Category = keyof typeof ERASURE_CATEGORIES;

/** Кто в журнале: ник после удаления и id — почты и имени уже нет. */
export const erasureSubject = (userId: string) => `${erasedUsername(userId)} (id ${userId})`;

/**
 * Сроки хранения и акт об уничтожении (часть 147, приказ РКН от 28.10.2022
 * № 179). Каждое уничтожение персональных данных — запись в журнал; записи
 * одного дня и одной причины собираются в акт. В консоли — акт для
 * подписи и выгрузка из журнала; через 3 года акт удаляется с журналом.
 *
 * Сроки — `retention.ts`: переписка удалённых — 3 года, данные для выдачи и
 * выданное в их сделках — 5 лет после года сделки. Суммы в учёте остаются:
 * аккаунт к этому времени обезличен.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private sweeping = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly storage: StorageService,
  ) {}

  /** Запись в журнал; акт дня (по Москве) и причины — при первой записи. */
  async record(
    reason: ErasureReason,
    e: { userId?: string | null; subject?: string; categories: Category[]; count?: number },
    now = new Date(),
  ) {
    const msk = new Date(now.getTime() + MSK_MS);
    const day = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()));
    const act = await this.actFor(day, reason);
    await this.prisma.erasureEvent.create({
      data: {
        at: now,
        reason,
        subject: e.subject ?? (e.userId ? erasureSubject(e.userId) : '—'),
        userId: e.userId ?? null,
        categories: e.categories.map((c) => ERASURE_CATEGORIES[c]),
        count: e.count ?? 1,
        actId: act.id,
      },
    });
  }

  private async actFor(day: Date, reason: string) {
    const find = () => this.prisma.erasureAct.findUnique({ where: { day_reason: { day, reason } } });
    const have = await find();
    if (have) return have;
    try {
      return await this.prisma.erasureAct.create({ data: { day, reason } });
    } catch (e) {
      // Два прохода разом создали один акт — берём тот, что успел первым.
      if ((e as { code?: string }).code === 'P2002') return (await find())!;
      throw e;
    }
  }

  @Interval('retention', SWEEP_MS)
  async sweep(now = new Date()) {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.eraseChats(now);
      await this.eraseDisputeChats(now);
      await this.scrubDeals(now);
      await this.dropOldActs(now);
    } catch (e) {
      this.logger.error(`Сроки хранения: ${(e as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }

  /** Переписка удалённых аккаунтов старше 3 лет — сообщения и вложения. */
  async eraseChats(now = new Date()) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; buyer_id: string; seller_id: string; b_erased: boolean; s_erased: boolean }>>`
      SELECT c."id", c."buyer_id", c."seller_id", b."erased_at" IS NOT NULL AS b_erased, s."erased_at" IS NOT NULL AS s_erased
      FROM "conversations" c
      JOIN "users" b ON b."id" = c."buyer_id"
      JOIN "users" s ON s."id" = c."seller_id"
      WHERE (b."erased_at" IS NOT NULL OR s."erased_at" IS NOT NULL)
        AND COALESCE(c."last_message_at", c."created_at") < ${utc(chatCutoff(now))}
        AND EXISTS (SELECT 1 FROM "messages" m WHERE m."conversation_id" = c."id")
      LIMIT ${BATCH}`;
    for (const c of rows) {
      const files = await this.prisma.attachment.findMany({ where: { message: { conversationId: c.id } }, select: { url: true } });
      const { count } = await this.prisma.message.deleteMany({ where: { conversationId: c.id } });
      await this.removeFiles(files.map((f) => f.url));
      for (const userId of [c.b_erased && c.buyer_id, c.s_erased && c.seller_id].filter((x): x is string => !!x)) {
        await this.record('chat_retention', { userId, categories: ['chat'], count }, now);
      }
    }
    return rows.length;
  }

  /** Переписка по спорам удалённых аккаунтов старше 3 лет. */
  async eraseDisputeChats(now = new Date()) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; buyer_id: string; seller_id: string; b_erased: boolean; s_erased: boolean }>>`
      SELECT d."id", o."buyer_id", o."seller_id", b."erased_at" IS NOT NULL AS b_erased, s."erased_at" IS NOT NULL AS s_erased
      FROM "disputes" d
      JOIN "orders" o ON o."id" = d."order_id"
      JOIN "users" b ON b."id" = o."buyer_id"
      JOIN "users" s ON s."id" = o."seller_id"
      WHERE (b."erased_at" IS NOT NULL OR s."erased_at" IS NOT NULL)
        AND COALESCE(d."resolved_at", d."created_at") < ${utc(chatCutoff(now))}
        AND EXISTS (SELECT 1 FROM "dispute_messages" m WHERE m."dispute_id" = d."id")
      LIMIT ${BATCH}`;
    for (const d of rows) {
      const msgs = await this.prisma.disputeMessage.findMany({ where: { disputeId: d.id }, select: { attachments: true } });
      const { count } = await this.prisma.disputeMessage.deleteMany({ where: { disputeId: d.id } });
      await this.removeFiles(msgs.flatMap((m) => fileKeys(m.attachments)));
      for (const userId of [d.b_erased && d.buyer_id, d.s_erased && d.seller_id].filter((x): x is string => !!x)) {
        await this.record('chat_retention', { userId, categories: ['dispute'], count }, now);
      }
    }
    return rows.length;
  }

  /**
   * Сделки удалённых покупателей старше 5 лет после года сделки: данные для
   * выдачи (ник, игровой ID, ссылка на обмен) и выданные ключи и аккаунты.
   * Сумма, комиссия и проводки остаются — они без персональных данных.
   */
  async scrubDeals(now = new Date()) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; buyer_id: string }>>`
      SELECT o."id", o."buyer_id"
      FROM "orders" o
      JOIN "users" b ON b."id" = o."buyer_id"
      WHERE b."erased_at" IS NOT NULL
        AND o."scrubbed_at" IS NULL
        AND o."created_at" < ${utc(dealCutoff(now))}
        AND o."status" IN ('completed', 'refunded', 'cancelled', 'expired')
      LIMIT ${BATCH}`;
    const perUser = new Map<string, number>();
    for (const o of rows) {
      const order = await this.prisma.order.findUnique({ where: { id: o.id }, select: { listingSnapshot: true } });
      const snap = { ...((order?.listingSnapshot ?? {}) as Record<string, unknown>) };
      delete snap.buyerData;
      delete snap.account;
      await this.prisma.$transaction([
        this.prisma.order.update({
          where: { id: o.id },
          data: { listingSnapshot: snap as Prisma.InputJsonValue, scrubbedAt: now },
        }),
        this.prisma.digitalGood.updateMany({ where: { reservedForOrderId: o.id }, data: { payloadEnc: '' } }),
      ]);
      perUser.set(o.buyer_id, (perUser.get(o.buyer_id) ?? 0) + 1);
    }
    for (const [userId, count] of perUser) {
      await this.record('deal_retention', { userId, categories: ['delivery', 'goods'], count }, now);
    }
    return rows.length;
  }

  /** Акты старше 3 лет — удалить вместе с журналом. */
  async dropOldActs(now = new Date()) {
    const { count } = await this.prisma.erasureAct.deleteMany({ where: { day: { lt: actCutoff(now) } } });
    return count;
  }

  private async removeFiles(keys: string[]) {
    for (const key of keys) {
      if (!key || /^https?:/.test(key)) continue;
      await this.storage.remove(key).catch(() => undefined);
    }
  }

  // ── Консоль ──

  async listActs(limit = 50) {
    const acts = await this.prisma.erasureAct.findMany({
      orderBy: { number: 'desc' },
      take: limit,
      include: { events: { select: { userId: true, categories: true, count: true } } },
    });
    const signers = await this.signerNames(acts.map((a) => a.signedBy));
    return acts.map((a) => ({
      id: a.id,
      number: a.number,
      day: a.day.toISOString().slice(0, 10),
      reason: a.reason,
      reasonText: ERASURE_REASONS[a.reason as ErasureReason] ?? a.reason,
      subjects: new Set(a.events.map((e) => e.userId)).size,
      records: a.events.reduce((s, e) => s + e.count, 0),
      categories: [...new Set(a.events.flatMap((e) => e.categories))],
      signedAt: a.signedAt,
      signedBy: a.signedBy ? (signers.get(a.signedBy) ?? a.signedBy) : null,
    }));
  }

  private async act(id: string) {
    const act = await this.prisma.erasureAct.findUnique({ where: { id }, include: { events: { orderBy: { at: 'asc' } } } });
    if (!act) throw new NotFoundException('Акт не найден');
    return act;
  }

  async sign(id: string, staffId: string) {
    const act = await this.act(id);
    if (act.signedAt) throw new ConflictException('Акт уже подписан');
    return this.prisma.erasureAct.update({ where: { id }, data: { signedBy: staffId, signedAt: new Date() }, select: { id: true, signedAt: true } });
  }

  /** Выгрузка из журнала (приказ № 179 п. 5): CSV для Excel. */
  async journalCsv(id: string) {
    const act = await this.act(id);
    const head = ['Дата и время (МСК)', 'Субъект', 'Категории персональных данных', 'Записей', 'Информационная система', 'Причина'];
    const lines = act.events.map((e) =>
      [mskTime(e.at), e.subject, e.categories.join(', '), String(e.count), ERASURE_SYSTEM, ERASURE_REASONS[e.reason as ErasureReason] ?? e.reason]
        .map(csvCell)
        .join(';'),
    );
    return { csv: `﻿${[head.map(csvCell).join(';'), ...lines].join('\r\n')}\r\n`, name: `gamemarket-erasure-journal-${act.number}.csv` };
  }

  /** Акт об уничтожении (приказ № 179 п. 3): страница для печати и подписи. */
  async actHtml(id: string) {
    const act = await this.act(id);
    const signer = act.signedBy ? (await this.signerNames([act.signedBy])).get(act.signedBy) ?? act.signedBy : null;
    const operator = process.env.OPERATOR_NAME?.trim() || '[наименование оператора — после регистрации ИП]';
    const address = process.env.OPERATOR_ADDRESS?.trim() || '[адрес оператора]';
    const responsible = process.env.PD_RESPONSIBLE?.trim() || '[ФИО ответственного за обработку персональных данных]';
    const subjects = [...new Set(act.events.map((e) => e.subject))];
    const categories = [...new Set(act.events.flatMap((e) => e.categories))];
    const day = act.day.toISOString().slice(0, 10).split('-').reverse().join('.');
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const li = (items: string[]) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Акт об уничтожении персональных данных № ${act.number}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#111}h1{font-size:20px}dt{font-weight:600;margin-top:12px}dd{margin:4px 0 0}.sign{margin-top:40px}</style></head><body>
<h1>Акт об уничтожении персональных данных № ${act.number}</h1>
<p>Составлен по требованиям приказа Роскомнадзора от 28.10.2022 № 179.</p>
<dl>
<dt>Оператор</dt><dd>${esc(operator)}, ${esc(address)}</dd>
<dt>Дата уничтожения</dt><dd>${day}</dd>
<dt>Субъекты, чьи данные уничтожены</dt><dd>${li(subjects)}</dd>
<dt>Категории уничтоженных персональных данных</dt><dd>${li(categories)}</dd>
<dt>Информационная система</dt><dd>${esc(ERASURE_SYSTEM)}</dd>
<dt>Способ уничтожения</dt><dd>${esc(ERASURE_METHOD)}</dd>
<dt>Причина уничтожения</dt><dd>${esc(ERASURE_REASONS[act.reason as ErasureReason] ?? act.reason)}</dd>
<dt>Записей уничтожено</dt><dd>${act.events.reduce((s, e) => s + e.count, 0)}</dd>
</dl>
<p>Подробности — выгрузка из журнала регистрации событий к акту № ${act.number}.</p>
<div class="sign">
<p>Уничтожение выполнено автоматически информационной системой по сроку.</p>
<p>Ответственный за обработку персональных данных: ${esc(responsible)} ________________</p>
${act.signedAt ? `<p>Подписан в консоли: ${esc(signer ?? '')}, ${mskTime(act.signedAt)} (МСК)</p>` : '<p>Не подписан.</p>'}
</div></body></html>`;
    return { html, name: `gamemarket-erasure-act-${act.number}.html` };
  }

  private async signerNames(ids: Array<string | null>) {
    const list = ids.filter((x): x is string => !!x);
    if (!list.length) return new Map<string, string>();
    const rows = await this.prisma.profile.findMany({ where: { userId: { in: list } }, select: { userId: true, username: true } });
    return new Map(rows.map((r) => [r.userId, r.username]));
  }
}

const mskTime = (d: Date) => new Date(d.getTime() + MSK_MS).toISOString().slice(0, 16).replace('T', ' ');
const csvCell = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Ключи файлов из вложений спора: строки, { key } или { url }. */
function fileKeys(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(fileKeys);
  if (typeof v === 'object') {
    const o = v as { key?: unknown; url?: unknown };
    return [o.key, o.url].filter((x): x is string => typeof x === 'string');
  }
  return [];
}
