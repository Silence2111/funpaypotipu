import { describe, expect, it, vi } from 'vitest';
import { authenticator } from 'otplib';
import { AttemptLimiter } from '../src/modules/auth/attempts';
import { TwoFactorService, newRecoveryCodes, normalizeRecovery } from '../src/modules/auth/twofactor.service';

/**
 * Вход с кодом из приложения. Раньше форма входа не спрашивала код вовсе:
 * кто включил защиту, тот больше не входил. Резервные коды — на случай
 * потерянного телефона, перебор кода — упирается в паузу.
 */

// Шифрование — тождество: проверяется логика, а не криптография.
const encryption = { encrypt: (s: string) => s, decrypt: (s: string) => s };

function setup() {
  const secret = authenticator.generateSecret();
  const row: { secretEnc: string; enabledAt: Date | null; recoveryCodesEnc: string | null } = {
    secretEnc: secret,
    enabledAt: null,
    recoveryCodesEnc: null,
  };
  const prisma = {
    twoFactor: {
      findUnique: vi.fn(async () => row),
      update: vi.fn(async ({ data }: { data: Partial<typeof row> }) => Object.assign(row, data)),
      upsert: vi.fn(async () => row),
      delete: vi.fn(async () => row),
    },
  };
  const svc = new TwoFactorService(prisma as never, encryption as never);
  return { svc, secret, row };
}

describe('вход с кодом из приложения', () => {
  it('без включённой защиты код не нужен', async () => {
    const { svc } = setup();
    expect(await svc.check('u1')).toBe('ok');
  });

  it('включена — без кода «спросить», с верным кодом — пускает', async () => {
    const { svc, secret } = setup();
    const { recoveryCodes } = await svc.enable('u1', authenticator.generate(secret));
    expect(recoveryCodes).toHaveLength(8);
    expect(await svc.check('u1')).toBe('required');
    expect(await svc.check('u1', authenticator.generate(secret))).toBe('ok');
  });

  it('резервный код работает один раз и в любом написании', async () => {
    const { svc, secret } = setup();
    const { recoveryCodes } = await svc.enable('u1', authenticator.generate(secret));
    const code = recoveryCodes[0]!;
    expect(await svc.check('u1', ` ${code.toUpperCase().replace('-', ' ')} `)).toBe('ok');
    expect(await svc.check('u1', code)).toBe('invalid');
    expect((await svc.status('u1')).recoveryLeft).toBe(7);
  });

  it('пять неверных кодов — пауза, даже для верного', async () => {
    const { svc, secret } = setup();
    await svc.enable('u1', authenticator.generate(secret));
    for (let i = 0; i < 5; i++) expect(await svc.check('u1', '000000')).toBe('invalid');
    expect(await svc.check('u1', authenticator.generate(secret))).toBe('locked');
  });

  it('ошибки входа различимы для формы', () => {
    expect(TwoFactorService.loginError('required').getResponse()).toMatchObject({ error: 'two_factor_required' });
    expect(TwoFactorService.loginError('locked').getStatus()).toBe(429);
  });
});

describe('резервные коды', () => {
  it('восемь разных кодов вида «abcde-fghjk» без похожих символов', () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
  });

  it('написание не важно', () => {
    expect(normalizeRecovery('ABCDE FGHJK')).toBe(normalizeRecovery('abcde-fghjk'));
  });
});

describe('ограничение попыток', () => {
  it('после max неудач — пауза до конца окна, успех сбрасывает счётчик', () => {
    const lim = new AttemptLimiter(3, 15 * 60_000);
    const t = 1_000_000;
    lim.fail('a', t);
    lim.fail('a', t);
    expect(lim.wait('a', t)).toBe(0);
    lim.fail('a', t);
    expect(lim.wait('a', t)).toBe(15);
    expect(lim.wait('a', t + 15 * 60_000)).toBe(0);
    lim.reset('a');
    expect(lim.wait('a', t)).toBe(0);
  });
});
