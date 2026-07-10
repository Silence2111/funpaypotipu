import { z } from 'zod';

/** Контракты каталога — общие для фронта и бэка. */

// Деньги на вход/выход API — строка минорных единиц (bigint не сериализуется в JSON).
const minorString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+$/.test(v), 'ожидается целое число минорных единиц');

export const createListingSchema = z.object({
  gameId: z.string().uuid(),
  categoryId: z.string().uuid(),
  title: z.string().min(3).max(120),
  description: z.string().min(1).max(10000),
  price: minorString, // копейки, напр. "150000" = 1500.00
  currency: z.string().length(3).default('RUB'),
  attributes: z.record(z.unknown()).default({}),
  images: z.array(z.string().min(1)).max(12).default([]), // ключи S3 или абсолютные URL
  stock: z.number().int().nonnegative().nullable().default(null),
});
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = createListingSchema
  .partial()
  .omit({ gameId: true })
  .extend({
    status: z.enum(['draft', 'active', 'paused']).optional(),
  });
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

export const listingQuerySchema = z.object({
  gameSlug: z.string().optional(),
  categorySlug: z.string().optional(),
  sellerId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  sort: z.enum(['new', 'price_asc', 'price_desc', 'popular']).default('new'),
  attrs: z.string().max(2000).optional(), // JSON вида {"rank":"Global Elite"}
  instant: z.coerce.boolean().optional(), // только мгновенная выдача (авто-ключи/пополнения)
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(60).default(24),
});
export type ListingQuery = z.infer<typeof listingQuerySchema>;

/** Форма карточки лота в ответах API (деньги — строкой). */
export interface ListingCard {
  id: string;
  title: string;
  price: string;
  currency: string;
  images: string[];
  seller: { username: string; ratingAvg: number };
}
