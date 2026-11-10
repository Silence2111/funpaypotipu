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

/**
 * Пустая переменная — не задана. compose передаёт незаполненное пустой
 * строкой, а значения по умолчанию в коде стоят через `??`, который пустую
 * строку не ловит: ссылки на файлы подписывались бы пустым ключом
 * (STORAGE_SIGNING_SECRET=''), ставка НДС в чеке становилась 0, адрес
 * отправителя писем — пустым.
 */
const dropEmpty = (): void => {
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value.trim() === '') delete process.env[key];
  }
};

loadRootEnv();
dropEmpty();

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
  DATA_ENCRYPTION_KEY: z.string().optional(),
});

/** Значения для разработки: с ними прод не запускается. */
const DEV_SECRETS = new Set(['change-me-access', 'change-me-refresh', 'dev-insecure-key']);
/** Секрет прода — не короче 32 знаков: `openssl rand -hex 32`. */
const MIN_SECRET = 32;

/**
 * В проде секреты обязательны. Раньше без них API молча стартовал со
 * значениями для разработки: JWT подписывался известным «change-me-access» —
 * любой выпускал себе вход под чужим аккаунтом, — а ключи товаров и
 * реквизиты выплат шифровались известным «dev-insecure-key».
 */
const productionSchema = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  const secrets = {
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
    DATA_ENCRYPTION_KEY: env.DATA_ENCRYPTION_KEY,
  };
  for (const [name, value] of Object.entries(secrets)) {
    if (!value || DEV_SECRETS.has(value) || value.length < MIN_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message: `в проде — свой секрет от ${MIN_SECRET} знаков (openssl rand -hex 32)`,
      });
    }
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_REFRESH_SECRET'],
      message: 'должен отличаться от JWT_ACCESS_SECRET',
    });
  }
});

export type AppEnv = z.infer<typeof envSchema>;

/** Проверка окружения без выхода из процесса — для тестов и loadEnv. */
export const parseEnv = (source: NodeJS.ProcessEnv) => productionSchema.safeParse(source);

export const loadEnv = (): AppEnv => {
  const parsed = parseEnv(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Некорректная конфигурация окружения:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
};
