import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { utc } from '../../common/sql-time';

/** Шаги воронки по порядку: ключ — для сайта, подпись — в консоли. */
export const FUNNEL_STEPS = [
  'registered',
  'firstLot',
  'firstRequest',
  'firstPaid',
  'firstDeal',
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface FunnelDay {
  day: string;
  registered: number;
  firstLot: number;
  firstRequest: number;
  firstPaid: number;
  firstDeal: number;
}

/** Сутки по Москве: время в базе — UTC без пояса. */
const msk = (col: string) =>
  Prisma.raw(`((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Moscow')::date`);

/**
 * Воронка запуска (часть 131) — по нашей базе, без внешних сервисов:
 * зарегистрировались → выставили первый лот → оставили первый запрос
 * «Хочу купить» → первая оплата заказа → первая завершённая сделка.
 *
 * По дням — сколько людей сделали свой первый шаг в этот день (по Москве).
 * Когорта — из тех, кто зарегистрировался за период, сколько дошли до
 * каждого шага к сегодняшнему дню: видно, где люди теряются.
 */
@Injectable()
export class FunnelService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async funnel(days: number, now = new Date()) {
    const span = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
    // Первый день периода по Москве и его начало (момент времени).
    const [first] = await this.prisma.$queryRaw<Array<{ d0: Date; start: Date }>>`
      SELECT d0, (d0::timestamp AT TIME ZONE 'Europe/Moscow') AS start
      FROM (SELECT ((${now}::timestamptz AT TIME ZONE 'Europe/Moscow')::date - ${span - 1}::int) AS d0) x`;
    const from = first!.start;
    const firstDay = first!.d0.toISOString().slice(0, 10);
    const rows = await this.prisma.$queryRaw<
      Array<{
        day: Date;
        registered: number;
        first_lot: number;
        first_request: number;
        first_paid: number;
        first_deal: number;
      }>
    >`
      WITH days AS (
        SELECT generate_series(${firstDay}::date, (${now}::timestamptz AT TIME ZONE 'Europe/Moscow')::date, interval '1 day')::date AS d
      ),
      reg AS (SELECT ${msk('created_at')} AS d, count(*)::int AS n FROM users WHERE created_at >= ${utc(from)} GROUP BY 1),
      lot AS (
        SELECT ${msk('m')} AS d, count(*)::int AS n
        FROM (SELECT seller_id, min(created_at) AS m FROM listings GROUP BY seller_id) x
        WHERE m >= ${utc(from)} GROUP BY 1
      ),
      req AS (
        SELECT ${msk('m')} AS d, count(*)::int AS n
        FROM (SELECT buyer_id, min(created_at) AS m FROM buy_requests GROUP BY buyer_id) x
        WHERE m >= ${utc(from)} GROUP BY 1
      ),
      paid AS (
        SELECT ${msk('m')} AS d, count(*)::int AS n
        FROM (SELECT buyer_id, min(paid_at) AS m FROM orders WHERE paid_at IS NOT NULL GROUP BY buyer_id) x
        WHERE m >= ${utc(from)} GROUP BY 1
      ),
      deal AS (
        SELECT ${msk('m')} AS d, count(*)::int AS n
        FROM (SELECT buyer_id, min(completed_at) AS m FROM orders WHERE completed_at IS NOT NULL GROUP BY buyer_id) x
        WHERE m >= ${utc(from)} GROUP BY 1
      )
      SELECT days.d AS day,
             coalesce(reg.n, 0) AS registered, coalesce(lot.n, 0) AS first_lot, coalesce(req.n, 0) AS first_request,
             coalesce(paid.n, 0) AS first_paid, coalesce(deal.n, 0) AS first_deal
      FROM days
      LEFT JOIN reg ON reg.d = days.d LEFT JOIN lot ON lot.d = days.d LEFT JOIN req ON req.d = days.d
      LEFT JOIN paid ON paid.d = days.d LEFT JOIN deal ON deal.d = days.d
      ORDER BY days.d DESC`;
    const byDay: FunnelDay[] = rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      registered: r.registered,
      firstLot: r.first_lot,
      firstRequest: r.first_request,
      firstPaid: r.first_paid,
      firstDeal: r.first_deal,
    }));

    // Когорта: зарегистрировались за период — сколько дошли до шага (когда угодно до сегодня).
    const [c] = await this.prisma.$queryRaw<
      Array<{
        registered: number;
        first_lot: number;
        first_request: number;
        first_paid: number;
        first_deal: number;
      }>
    >`
      WITH c AS (SELECT id FROM users WHERE created_at >= ${utc(from)})
      SELECT (SELECT count(*) FROM c)::int AS registered,
             (SELECT count(*) FROM c WHERE EXISTS (SELECT 1 FROM listings l WHERE l.seller_id = c.id))::int AS first_lot,
             (SELECT count(*) FROM c WHERE EXISTS (SELECT 1 FROM buy_requests b WHERE b.buyer_id = c.id))::int AS first_request,
             (SELECT count(*) FROM c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.buyer_id = c.id AND o.paid_at IS NOT NULL))::int AS first_paid,
             (SELECT count(*) FROM c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.buyer_id = c.id AND o.completed_at IS NOT NULL))::int AS first_deal`;
    const cohort = {
      registered: c?.registered ?? 0,
      firstLot: c?.first_lot ?? 0,
      firstRequest: c?.first_request ?? 0,
      firstPaid: c?.first_paid ?? 0,
      firstDeal: c?.first_deal ?? 0,
    };
    return { days: span, from, byDay, cohort };
  }
}
