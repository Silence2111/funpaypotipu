import { z } from 'zod';

/** Типобезопасная загрузка и валидация конфигурации при старте. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(8).default('change-me-access'),
  JWT_REFRESH_SECRET: z.string().min(8).default('change-me-refresh'),
  JWT_ACCESS_TTL: z.coerce.number().default(900),
  JWT_REFRESH_TTL: z.coerce.number().default(2592000),
});

export type AppEnv = z.infer<typeof envSchema>;

export const loadEnv = (): AppEnv => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Некорректная конфигурация окружения:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
};
