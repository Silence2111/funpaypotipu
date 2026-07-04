import { z } from 'zod';

/** Контракты auth — общие для фронта и бэка (валидация + типы). */

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_]+$/, 'только строчные латинские буквы, цифры и _'),
});
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
