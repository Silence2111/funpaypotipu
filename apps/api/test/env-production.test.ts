import { describe, expect, it } from 'vitest';

process.env.SKIP_DOTENV = '1';
// Пустые переменные из compose — как незаданные: проверяется при загрузке модуля.
process.env.GM_TEST_EMPTY = '';
process.env.GM_TEST_SPACES = '  ';
process.env.GM_TEST_SET = 'x';
const { parseEnv } = await import('../src/config/env');

it('пустая переменная — не задана: значения по умолчанию через ?? снова работают', () => {
  expect('GM_TEST_EMPTY' in process.env).toBe(false);
  expect('GM_TEST_SPACES' in process.env).toBe(false);
  expect(process.env.GM_TEST_SET).toBe('x');
});

/**
 * Прод не стартует со значениями для разработки. Раньше без JWT_* и
 * DATA_ENCRYPTION_KEY API запускался с «change-me-access» — вход под любым
 * аккаунтом подделывался известным ключом — и шифровал ключи товаров и
 * реквизиты выплат известным «dev-insecure-key».
 */

const DB = 'postgresql://u:p@localhost:5432/db';
const strong = (c: string) => c.repeat(64);
const prod = (extra: Record<string, string | undefined> = {}) =>
  parseEnv({
    NODE_ENV: 'production',
    DATABASE_URL: DB,
    JWT_ACCESS_SECRET: strong('a'),
    JWT_REFRESH_SECRET: strong('b'),
    DATA_ENCRYPTION_KEY: strong('c'),
    ...extra,
  });
const problems = (r: ReturnType<typeof parseEnv>) =>
  r.success ? [] : Object.keys(r.error.flatten().fieldErrors).sort();

describe('окружение прода', () => {
  it('свои секреты от 32 знаков — запускается', () => {
    expect(prod().success).toBe(true);
  });

  it('без секретов — не запускается: значения для разработки не подставляются молча', () => {
    expect(
      problems(prod({ JWT_ACCESS_SECRET: undefined, JWT_REFRESH_SECRET: undefined, DATA_ENCRYPTION_KEY: undefined })),
    ).toEqual(['DATA_ENCRYPTION_KEY', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']);
  });

  it('значения для разработки и короткие секреты — не запускается', () => {
    expect(problems(prod({ JWT_ACCESS_SECRET: 'change-me-access' }))).toEqual(['JWT_ACCESS_SECRET']);
    expect(problems(prod({ DATA_ENCRYPTION_KEY: 'dev-insecure-key' }))).toEqual(['DATA_ENCRYPTION_KEY']);
    expect(problems(prod({ JWT_REFRESH_SECRET: 'short-secret-123' }))).toEqual(['JWT_REFRESH_SECRET']);
  });

  it('один секрет на оба токена — не запускается', () => {
    expect(problems(prod({ JWT_REFRESH_SECRET: strong('a') }))).toEqual(['JWT_REFRESH_SECRET']);
  });

  it('вне прода значения для разработки допустимы — локальный запуск и e2e не ломаются', () => {
    expect(parseEnv({ NODE_ENV: 'development', DATABASE_URL: DB }).success).toBe(true);
    expect(parseEnv({ DATABASE_URL: DB }).success).toBe(true);
  });
});
