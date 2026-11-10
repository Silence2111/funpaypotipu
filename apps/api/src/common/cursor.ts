import { z } from 'zod';

/**
 * Курсор «Показать ещё» для списков по времени: `next` прошлой страницы —
 * «время_id» последней показанной строки. Время в нём — то, по которому
 * идёт список; id — чтобы строки с одним временем не терялись и не
 * повторялись. Битый курсор — 400 с текстом `stale`.
 */
export const timeCursor = (stale: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      const m = /^(.+)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(v);
      const at = m ? new Date(m[1]!) : null;
      if (!m || !at || Number.isNaN(at.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: stale });
        return z.NEVER;
      }
      return { at, id: m[2]! };
    });

/** `next` для строки, на которой закончилась страница. */
export const nextCursor = (at: Date, id: string) => `${at.toISOString()}_${id}`;
