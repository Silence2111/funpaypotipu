import { z } from 'zod';
import { isDemoSeller } from '../demo';

/** Контракты auth — общие для фронта и бэка (валидация + типы). */

/** Ник: по нему находят продавца и отзывы, поэтому он не меняется. */
export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9_]+$/, 'только строчные латинские буквы, цифры и _')
  // Ник демо-продавца подписывает все лоты «Пример»: живой продавец с таким
  // ником на проде продавал бы «примеры».
  .refine((u) => !isDemoSeller(u), 'Это имя занято');

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  username: usernameSchema,
});

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/**
 * Подсказка ника из имени в Telegram, VK или Google: «Мирослава Ким» →
 * «miroslava_kim». Подходит ли ник и свободен ли — проверяет сервер.
 */
export function suggestUsername(...names: Array<string | null | undefined>): string {
  for (const raw of names) {
    const latin = (raw ?? '')
      .toLowerCase()
      .split('')
      .map((c) => TRANSLIT[c] ?? c)
      .join('')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24)
      .replace(/_+$/, '');
    if (latin.length >= 3 && !isDemoSeller(latin)) return latin;
  }
  return 'player';
}
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  code: z.string().optional(), // TOTP-код, если включена 2FA
});
export type LoginInput = z.infer<typeof loginSchema>;

export const authResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email().nullable(),
    username: z.string(),
  }),
  accessToken: z.string(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
