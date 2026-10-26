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

/** Совпадает ли строка с условием: простые значения, даты и null — как в Prisma. */
const fits = (r: Row, where: Row) =>
  Object.entries(where).every(([k, v]) =>
    v instanceof Date
      ? (r[k] as Date | null)?.getTime() === v.getTime()
      : v === null || typeof v !== 'object'
        ? (r[k] ?? null) === v
        : true,
  );

function setup(opts: { kyc?: boolean; taken?: number } = {}) {
  const recs: Row[] = [];
  const cleared: string[] = [];
  const prisma = {
    user: {
      findFirst: vi.fn(async ({ where }: { where: { email: { equals: string } } }) =>
        where.email.equals.toLowerCase() === 'owner@e.x' ? { id: 'u1', email: 'owner@e.x' } : null,
      ),
      findUnique: vi.fn(async () => ({ locale: 'ru', email: 'owner@e.x' })),
      count: vi.fn(async () => opts.taken ?? 0),
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
        const hit = recs.filter((r) => fits(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) =>
        Object.assign(
          recs.find((r) => r.id === where.id)!,
          data,
        ),
      ),
      count: vi.fn(async () => 0),
    },
    kycVerification: {
      findFirst: vi.fn(async () =>
        opts.kyc
          ? {
              documentRefs: { keys: ['kyc/u1/doc.jpg'], selfie: 'kyc/u1/me.jpg' },
              reviewedAt: new Date(),
            }
          : null,
      ),
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
  const storage = {
    enabled: true,
    presignPut: vi.fn(async (key: string) => `https://up/${key}`),
    presignGet: vi.fn(async (key: string) => `https://get/${key}`),
    getBytes: vi.fn(async () => Buffer.from('jpeg')),
    remove: vi.fn(async () => undefined),
  };
  const scanner = { scan: vi.fn(async () => ({ clean: true })) };
  const mail = { enabled: true, send: vi.fn(async () => undefined) };
  const svc = new RecoveryService(
    prisma as never,
    notifications as never,
    tokens,
    audit as never,
    storage as never,
    scanner as never,
    mail as never,
  );
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
  /** Заявка без доступа к почте: с новой почтой для связи. */
  const askNew = () =>
    svc.request(
      {
        email: 'owner@e.x',
        reason: 'password',
        orderNumbers: [],
        details: 'Нет доступа к почте',
        newEmail: 'New@Mail.x',
      },
      { userAgent: CHROME },
    );
  /** Токен из письма «Загрузите документы». */
  const docsToken = () => {
    const body = (mail.send.mock.calls.at(-1) as unknown as [string, string, string])[2];
    return decodeURIComponent(/token=([^\s]+)/.exec(body)![1]!);
  };
  return {
    svc,
    prisma,
    recs,
    cleared,
    notifications,
    audit,
    tokens,
    mail,
    storage,
    ask,
    askNew,
    docsToken,
  };
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

describe('нет доступа и к почте', () => {
  it('новая почта — в заявке и в уведомлении владельцу; та же, что у аккаунта, — не новая', async () => {
    const { recs, notifications, askNew } = setup();
    await askNew();
    await flush();
    expect(recs[0]!.contactEmail).toBe('new@mail.x');
    expect(
      (notifications.notify.mock.calls[0] as unknown as [string, string, Row])[2],
    ).toMatchObject({
      preview: expect.stringMatching(/с просьбой сменить почту/),
    });
    const same = setup();
    await same.svc.request(
      {
        email: 'owner@e.x',
        reason: 'other',
        orderNumbers: [],
        details: 'та же почта',
        newEmail: 'OWNER@e.x',
      },
      {},
    );
    expect(same.recs[0]!.contactEmail).toBeNull();
  });

  it('документы просят только при пройденной проверке личности; новая просьба гасит прежнюю ссылку', async () => {
    const without = setup();
    await without.askNew();
    await expect(without.svc.requestEvidence('r1', 'staff')).rejects.toThrow(/проверки личности/);

    const { svc, mail, askNew, docsToken } = setup({ kyc: true });
    await askNew();
    await svc.requestEvidence('r1', 'staff');
    expect(mail.send).toHaveBeenLastCalledWith(
      'new@mail.x',
      expect.any(String),
      expect.stringMatching(/\/recover\/docs\?token=/),
    );
    const first = docsToken();
    await expect(svc.docsStatus(first)).resolves.toEqual({ ok: true, submitted: false });
    await new Promise((r) => setTimeout(r, 5));
    await svc.requestEvidence('r1', 'staff');
    await expect(svc.docsStatus(first)).rejects.toThrow(/недействительна/);
    await expect(svc.docsStatus(docsToken())).resolves.toEqual({ ok: true, submitted: false });
  });

  it('по ссылке — только свои файлы и один раз', async () => {
    const { svc, recs, askNew, docsToken } = setup({ kyc: true });
    await askNew();
    await svc.requestEvidence('r1', 'staff');
    const token = docsToken();
    const up = await svc.docsUpload(token, 'image/jpeg');
    expect(up.key).toMatch(/^recovery\/r1\/[\w-]+\.jpg$/);
    await expect(svc.docsSubmit(token, ['kyc/u1/doc.jpg'], up.key)).rejects.toThrow(
      /не из этой заявки/,
    );
    const doc = await svc.docsUpload(token, 'image/png');
    await svc.docsSubmit(token, [doc.key], up.key);
    expect(recs[0]!.evidenceAt).toBeInstanceOf(Date);
    await expect(svc.docsSubmit(token, [doc.key], up.key)).rejects.toMatchObject({ status: 409 });
  });

  it('на новую почту — только с документами и если почта свободна; старой почте — письмо', async () => {
    const taken = setup({ kyc: true, taken: 1 });
    await taken.askNew();
    const old = new Date(Date.now() + RECOVERY_WAIT_MS);
    await expect(taken.svc.restoreToNewEmail('r1', 'staff', undefined, old)).rejects.toThrow(
      /не присланы/,
    );

    const { svc, recs, cleared, mail, audit, notifications, askNew, docsToken, prisma } = setup({
      kyc: true,
    });
    await askNew();
    await svc.requestEvidence('r1', 'staff');
    const token = docsToken();
    const [a, b] = [
      await svc.docsUpload(token, 'image/jpeg'),
      await svc.docsUpload(token, 'image/jpeg'),
    ];
    await svc.docsSubmit(token, [a.key], b.key);
    const later = new Date((recs[0]!.createdAt as Date).getTime() + RECOVERY_WAIT_MS);
    await svc.restoreToNewEmail('r1', 'staff', '10.0.0.1', later);
    await flush();
    expect(recs[0]!.status).toBe('restored');
    expect(cleared).toContain('user:passwordHash,telegramId,email,emailVerified');
    const userUpdate = prisma.user.update.mock.calls.at(-1)![0] as unknown as { data: Row };
    expect(userUpdate.data).toMatchObject({ email: 'new@mail.x', passwordHash: null });
    // Старой почте — куда сменили, адрес скрыт.
    expect(mail.send).toHaveBeenCalledWith(
      'owner@e.x',
      expect.any(String),
      expect.stringMatching(/n\*\*\*@mail\.x/),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recovery.restore_new_email',
        before: { email: 'owner@e.x' },
      }),
    );
    expect((notifications.notify.mock.calls.at(-1) as unknown as [string, string])[1]).toBe(
      'recovery_restored',
    );

    // Занятую почту не привязать.
    const busy = setup({ kyc: true, taken: 1 });
    await busy.askNew();
    await busy.svc.requestEvidence('r1', 'staff');
    const t2 = busy.docsToken();
    const [c, d] = [
      await busy.svc.docsUpload(t2, 'image/jpeg'),
      await busy.svc.docsUpload(t2, 'image/jpeg'),
    ];
    await busy.svc.docsSubmit(t2, [c.key], d.key);
    await expect(
      busy.svc.restoreToNewEmail(
        'r1',
        'staff',
        undefined,
        new Date((busy.recs[0]!.createdAt as Date).getTime() + RECOVERY_WAIT_MS),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
