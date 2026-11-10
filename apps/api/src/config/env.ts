import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Переменные из `.env` в корне монорепо.
 *
 * README обещает «cp .env.example .env && pnpm dev», но ничего эти переменные
 * в процесс не клало: в Docker их подставляет compose, а при запуске Node
 * на хосте приложение падало на «DATABASE_URL: Required». Документированный
 * путь запуска не работал.
 *
 * Ищем вверх по дереву от рабочего каталога: так работает и из `apps/api`,
 * и из корня. Уже заданные переменные окружения не перетираются — в Docker
 * и на проде они главнее файла.
 */
const loadRootEnv = (): void => {
  if (process.env.SKIP_DOTENV === '1') return;
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, override: false });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
};

loadRootEnv();

/** Типобезопасная загрузка и валидация конфигурации при старте. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  // Пустая строка в .env означает «выключено», а не «плохой URL»:
  // `.optional()` этого не ловит, потому что пустая строка — это значение.
  REDIS_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional(),
  ),
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
