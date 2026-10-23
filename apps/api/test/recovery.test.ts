import { beforeAll, describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { RECOVERY_WAIT_MS, RecoveryService } from '../src/modules/recovery/recovery.service';
import { TokenService } from '../src/modules/auth/token.service';
import { passwordStamp } from '../src/modules/auth/auth.service';

/**
 * «Не могу войти»: ответ на заявку один — есть аккаунт или нет; владельцу —
 * уведомление; решить — не раньше чем через 3 дня; восстановление сбрасывает
 * всё, чем мог завладеть чужой, а ссылка задать пароль — на почту аккаунта.
 */

type Row = Record<string, unknown>;
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'access-secret';
});

function setup() {
  const recs: Row[] = [];
  const cleared: string[] = [];
  const prisma = {
    user: {
      findFirst: vi.fn(async ({ where }: { where: { email: { equals: string } } }) =>
        where.email.equals.toLowerCase() === 'owner@e.x' ? { id: 'u1' } : null,
      ),
      findUnique: vi.fn(async () => ({ locale: 'ru' })),
      update: vi.fn(async ({ data }: { data: Row }) => {
        cleared.push(`user:${Object.keys(data).join(',')}`);
        return {};
      }),
    },
    accountRecovery: {
      findFirst: vi.fn(
        async ({ where }: { where: Row }) =>
          recs.find((r) => r.userId === where.userId && r.status === where.status) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => recs.find((r) => r.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const rec = {
          id: `r${recs.length + 1}`,
          status: 'pending',
          objectedAt: null,
          createdAt: new Date(),
          ...data,
        };
        recs.push(rec);
        return rec;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = recs.filter(
          (r) =>
            r.id === where.id &&
            r.status === where.status &&
            (where.userId === undefined || r.userId === where.userId) &&
            (!('objectedAt' in where) || r.objectedAt === where.objectedAt),
        );
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      count: vi.fn(async () => 0),
    },
    twoFactor: { deleteMany: vi.fn(async () => (cleared.push('twoFactor'), { count: 1 })) },
    socialAccount: { deleteMany: vi.fn(async () => (cleared.push('social'), { count: 1 })) },
    pushSubscription: { deleteMany: vi.fn(async () => (cleared.push('push'), { count: 1 })) },
    authSession: { deleteMany: vi.fn(async () => (cleared.push('sessions'), { count: 2 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const notifications = { notify: vi.fn(async () => undefined) };
  const audit = { log: vi.fn(async () => undefined) };
  const tokens = new TokenService(new JwtService());
  const svc = new RecoveryService(prisma as never, notifications as never, tokens, audit as never);
  const ask = (email = 'Owner@e.x') =>
    svc.request(
      {
        email,
        reason: 'two_factor',
        orderNumbers: [' gm-a1 ', 'GM-A1', 'gm-b2'],
        details: 'Чужой включил вход с кодом',
      },
      { userAgent: CHROME, ip: '198.51.100.9' },
    );
  return { svc, prisma, recs, cleared, notifications, audit, tokens, ask };
}

describe('«Не могу войти»', () => {
  it('ответ один и тот же; заявка — только на существующий аккаунт и одна в ожидании', async () => {
    const { recs, notifications, ask } = setup();
    expect(await ask('nobody@e.x')).toEqual({ ok: true });
    expect(recs).toHaveLength(0);
    expect(await ask()).toEqual({ ok: true });
    expect(await ask()).toEqual({ ok: true });
    expect(recs).toHaveLength(1);
    // Номера — без пробелов и повторов (регистр не важен), как ввели.
    expect(recs[0]!.orderNumbers).toEqual(['gm-a1', 'gm-b2']);
    await flush();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      'recovery_requested',
      {
        recoveryId: 'r1',
        preview: expect.stringMatching(
          /^Подана заявка на восстановление доступа к аккаунту: Chrome · Windows\./,
        ),
      },
      {},
    );
  });

  it('«Заявку подал не я» из аккаунта — отметка с устройством, чужая заявка — 404', async () => {
    const { svc, recs, ask } = setup();
    await ask();
    await svc.object('u1', 'r1', { userAgent: CHROME, ip: '203.0.113.5' });
    expect(recs[0]!.objectedAt).toBeInstanceOf(Date);
    expect(recs[0]!.objectedFrom).toBe('Chrome · Windows · IP 203.0.113.5');
    await expect(svc.object('u2', 'r1', {})).rejects.toMatchObject({ status: 404 });
  });

  it('раньше 3 дней — нельзя; потом — всё сброшено, ссылка задать пароль — только в письме', async () => {
    const { svc, recs, cleared, notifications, audit, tokens, ask } = setup();
    await ask();
    const created = (recs[0]!.createdAt as Date).getTime();
    await expect(
      svc.restore('r1', 'staff', undefined, new Date(created + RECOVERY_WAIT_MS - 60_000)),
    ).rejects.toThrow(/через 3 дня/);
    await svc.restore('r1', 'staff', '10.0.0.1', new Date(created + RECOVERY_WAIT_MS));
    await flush();
    expect(recs[0]!.status).toBe('restored');
    expect(cleared).toEqual([
      'twoFactor',
      'social',
      'push',
      'sessions',
      'user:passwordHash,telegramId',
    ]);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recovery.restore', entityId: 'u1', actorId: 'staff' }),
    );
    const [, type, payload, opts] = notifications.notify.mock.calls.at(-1) as unknown as [
      string,
      string,
      Row,
      { mail: { action: string; link: string } },
    ];
    expect(type).toBe('recovery_restored');
    expect(JSON.stringify(payload)).not.toMatch(/token/);
    const token = new URL(opts.mail.link).searchParams.get('token')!;
    // Ссылка сброса привязана к «пароля нет»: сработает один раз, пока пароль не задан.
    expect(tokens.verifyBound(token, 'pwd_reset')).toEqual({
      sub: 'u1',
      bind: passwordStamp(null),
    });
    await expect(
      svc.restore('r1', 'staff', undefined, new Date(created + RECOVERY_WAIT_MS * 2)),
    ).rejects.toThrow(/уже решено/);
  });

  it('отклонение — с причиной владельцу; второй раз — уже решено', async () => {
    const { svc, recs, notifications, ask } = setup();
    await ask();
    await svc.reject('r1', 'staff', 'Заказы из заявки — не этого аккаунта');
    await flush();
    expect(recs[0]!.status).toBe('rejected');
    expect(notifications.notify).toHaveBeenLastCalledWith(
      'u1',
      'recovery_rejected',
      {
        recoveryId: 'r1',
        preview: 'Заявка на восстановление доступа отклонена: Заказы из заявки — не этого аккаунта',
      },
      {},
    );
    await expect(svc.reject('r1', 'staff', 'ещё раз')).rejects.toThrow(/уже решено/);
  });
});
