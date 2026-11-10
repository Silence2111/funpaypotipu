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

/** Другая сторона сделок: ник → id и сколько завершённых сделок с аккаунтом. */
type Parties = Record<string, { id: string; deals: number }>;

/** Оплата картой в аккаунте: карта — у ЮKassa или уже запомнена. */
type PaidRow = { id: string; externalId: string; card: Row | null; createdAt: Date };
/** Платёж у тестовой ЮKassa: статус и карта. */
type Hold = { id: string; status: string; url?: string; card?: Row; metadata: Row };

function setup(
  opts: {
    kyc?: boolean;
    taken?: number;
    parties?: Parties;
    payments?: PaidRow[];
    yookassa?: boolean;
  } = {},
) {
  const recs: Row[] = [];
  const deals: Row[] = [];
  const cleared: string[] = [];
  const parties = opts.parties ?? {};
  const prisma = {
    user: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { email?: { equals: string }; profile?: { username: { equals: string } } };
        }) => {
          if (where.profile) {
            const p = parties[where.profile.username.equals.toLowerCase()];
            return p ? { id: p.id } : null;
          }
          return where.email?.equals.toLowerCase() === 'owner@e.x'
            ? { id: 'u1', email: 'owner@e.x' }
            : null;
        },
      ),
      findUnique: vi.fn(async () => ({
        locale: 'ru',
        email: 'owner@e.x',
        profile: { username: 'owner' },
      })),
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
    payment: {
      count: vi.fn(async () => (opts.payments ?? []).length),
      findMany: vi.fn(async () => opts.payments ?? []),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) =>
        Object.assign(
          opts.payments!.find((p) => p.id === where.id)!,
          data,
        ),
      ),
    },
    payout: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    order: {
      count: vi.fn(
        async ({ where }: { where: { OR?: Array<{ sellerId?: string }> } }) =>
          Object.values(parties).find((p) => p.id === where.OR?.[0]?.sellerId)?.deals ?? 0,
      ),
    },
    recoveryDeal: {
      deleteMany: vi.fn(async ({ where }: { where: { recoveryId: string } }) => {
        const keep = deals.filter((d) => d.recoveryId !== where.recoveryId);
        deals.splice(0, deals.length, ...keep);
        return { count: 0 };
      }),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        deals.push(...data.map((d) => ({ answer: null, answeredAt: null, answerIp: null, ...d })));
        return { count: data.length };
      }),
      findMany: vi.fn(async ({ where }: { where: Row }) => deals.filter((d) => fits(d, where))),
      findFirst: vi.fn(
        async ({ where }: { where: Row }) => deals.find((d) => fits(d, where)) ?? null,
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = deals.filter((d) => fits(d, where));
        hit.forEach((d) => Object.assign(d, data));
        return { count: hit.length };
      }),
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
  const holds = new Map<string, Hold>();
  let held = 0;
  const yookassa = {
    enabled: opts.yookassa ?? true,
    createHold: vi.fn(async (input: { metadata: Row }) => {
      const id = `h${++held}`;
      holds.set(id, { id, status: 'pending', url: `https://yk/${id}`, metadata: input.metadata });
      return { id, url: `https://yk/${id}` };
    }),
    payment: vi.fn(async (id: string) => holds.get(id) ?? null),
    cancel: vi.fn(async (id: string) => {
      holds.get(id)!.status = 'canceled';
    }),
  };
  const encryption = { decrypt: (v: string) => v };
  const svc = new RecoveryService(
    prisma as never,
    notifications as never,
    tokens,
    audit as never,
    storage as never,
    scanner as never,
    mail as never,
    yookassa as never,
    encryption as never,
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
  /** Токен из последнего письма — «Загрузите документы» или «Опишите сделки». */
  const docsToken = () => {
    const body = (mail.send.mock.calls.at(-1) as unknown as [string, string, string])[2];
    return decodeURIComponent(/token=([^\s]+)/.exec(body)![1]!);
  };
  return {
    svc,
    prisma,
    recs,
    deals,
    cleared,
    notifications,
    audit,
    tokens,
    mail,
    storage,
    yookassa,
    holds,
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

describe('нет проверки личности — по сделкам', () => {
  const text = (n: number) => `Сделка ${n}: купил золото, договорились в чате о времени`;
  const PARTIES: Parties = {
    seller1: { id: 'p1', deals: 2 },
    seller2: { id: 'p2', deals: 1 },
    seller3: { id: 'p3', deals: 1 },
    ghost: { id: 'p9', deals: 0 },
  };
  /** Заявка с новой почтой, ссылка «Опишите сделки» и описания с IP заявителя. */
  async function described(names: string[], parties = PARTIES) {
    const t = setup({ parties });
    await t.askNew();
    await t.svc.requestDeals('r1', 'staff');
    await t.svc.dealsSubmit(
      t.docsToken(),
      names.map((counterparty, i) => ({ counterparty, text: text(i + 1) })),
      '203.0.113.5',
    );
    await flush();
    const later = new Date((t.recs[0]!.createdAt as Date).getTime() + RECOVERY_WAIT_MS);
    const id = (who: string) => t.deals.find((d) => d.counterpartyId === who)!.id as string;
    return { ...t, later, id };
  }

  it('сделки просят только без проверки личности; ссылка — своя, документы по ней не загрузить', async () => {
    const withKyc = setup({ kyc: true });
    await withKyc.askNew();
    await expect(withKyc.svc.requestDeals('r1', 'staff')).rejects.toThrow(/попросите документы/);

    const { svc, mail, askNew, docsToken } = setup();
    await askNew();
    await svc.requestDeals('r1', 'staff');
    expect(mail.send).toHaveBeenLastCalledWith(
      'new@mail.x',
      expect.any(String),
      expect.stringMatching(/\/recover\/deals\?token=/),
    );
    const token = docsToken();
    await expect(svc.dealsStatus(token)).resolves.toEqual({ ok: true, submitted: false });
    await expect(svc.docsStatus(token)).rejects.toThrow(/недействительна/);
  });

  it('описания — один раз; спрашивают только тех, с кем у аккаунта были завершённые сделки', async () => {
    const dup = setup({ parties: PARTIES });
    await dup.askNew();
    await dup.svc.requestDeals('r1', 'staff');
    await expect(
      dup.svc.dealsSubmit(dup.docsToken(), [
        { counterparty: 'seller1', text: text(1) },
        { counterparty: '@SELLER1', text: text(2) },
      ]),
    ).rejects.toThrow(/другим продавцом/);

    const { svc, deals, notifications, docsToken } = await described([
      '@Seller1',
      'ghost',
      'nobody',
    ]);
    expect(deals.map((d) => d.counterpartyId)).toEqual(['p1', null, null]);
    const asked = notifications.notify.mock.calls.filter(
      (c) => (c as unknown as [string, string])[1] === 'deal_check',
    ) as unknown as Array<[string, string, Row]>;
    expect(asked).toHaveLength(1);
    expect(asked[0]![0]).toBe('p1');
    expect(asked[0]![2]).toMatchObject({ checkId: deals[0]!.id, username: 'owner' });
    await expect(
      svc.dealsSubmit(docsToken(), [
        { counterparty: 'seller2', text: text(1) },
        { counterparty: 'seller3', text: text(2) },
      ]),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('ответ другой стороны — только на свою просьбу и один раз', async () => {
    const { svc, id } = await described(['seller1', 'seller2']);
    await expect(svc.answerCheck('p2', id('p1'), 'match')).rejects.toMatchObject({ status: 404 });
    await expect(svc.answerCheck('p1', id('p1'), 'match', '198.51.100.1')).resolves.toEqual({
      ok: true,
    });
    await expect(svc.answerCheck('p1', id('p1'), 'mismatch')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('на новую почту — два разных подтверждения не с IP заявителя; старой почте — письмо', async () => {
    const { svc, recs, mail, audit, id, later, prisma } = await described([
      'seller1',
      'seller2',
      'seller3',
    ]);
    await expect(svc.restoreToNewEmail('r1', 'staff', undefined, later)).rejects.toThrow(
      /двух разных/,
    );
    // С того же IP, что описания, — похоже, отвечает сам заявитель: не считается.
    await svc.answerCheck('p1', id('p1'), 'match', '203.0.113.5');
    await svc.answerCheck('p2', id('p2'), 'match', '198.51.100.2');
    await expect(svc.restoreToNewEmail('r1', 'staff', undefined, later)).rejects.toThrow(
      /двух разных/,
    );
    await svc.answerCheck('p3', id('p3'), 'match', '198.51.100.3');
    await svc.restoreToNewEmail('r1', 'staff', '10.0.0.1', later);
    expect(recs[0]!.status).toBe('restored');
    const userUpdate = prisma.user.update.mock.calls.at(-1)![0] as unknown as { data: Row };
    expect(userUpdate.data).toMatchObject({ email: 'new@mail.x', passwordHash: null });
    expect(mail.send).toHaveBeenCalledWith(
      'owner@e.x',
      expect.any(String),
      expect.stringMatching(/подтвердили их участники/),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recovery.restore_new_email',
        after: expect.objectContaining({ proof: 'deals' }),
      }),
    );
  });

  it('«не совпадает» от участника или возражение из аккаунта — на новую почту нельзя', async () => {
    const denied = await described(['seller1', 'seller2', 'seller3']);
    await denied.svc.answerCheck('p1', denied.id('p1'), 'match', '198.51.100.1');
    await denied.svc.answerCheck('p2', denied.id('p2'), 'match', '198.51.100.2');
    await denied.svc.answerCheck('p3', denied.id('p3'), 'mismatch', '198.51.100.3');
    await expect(
      denied.svc.restoreToNewEmail('r1', 'staff', undefined, denied.later),
    ).rejects.toThrow(/не совпадает/);

    const objected = await described(['seller1', 'seller2']);
    await objected.svc.answerCheck('p1', objected.id('p1'), 'match', '198.51.100.1');
    await objected.svc.answerCheck('p2', objected.id('p2'), 'match', '198.51.100.2');
    await objected.svc.object('u1', 'r1', { userAgent: CHROME });
    await expect(
      objected.svc.restoreToNewEmail('r1', 'staff', undefined, objected.later),
    ).rejects.toThrow(/Заявку подал не я/);
    // Заявка ждёт решения: сотрудник может восстановить на прежнюю почту или отклонить.
    expect(objected.recs[0]!.status).toBe('pending');
  });
});

describe('проверка картой', () => {
  const OLD = new Date(Date.now() - 40 * 86_400_000);
  const MINE = { first6: '220220', last4: '4477' };
  const paid = (at = OLD): PaidRow[] => [
    { id: 'pay1', externalId: 'yk1', card: { ...MINE }, createdAt: at },
  ];
  /** Банк ответил ЮKassa: сумма заблокирована (или отклонена) с этой карты. */
  const bank = (holds: Map<string, Hold>, id: string, status: string, card: Row) =>
    Object.assign(holds.get(id)!, { status, card });
  /** Заявка с новой почтой и ссылка «Проверка картой». */
  async function asked(opts: Parameters<typeof setup>[0] = {}) {
    const t = setup({ payments: paid(), ...opts });
    await t.askNew();
    await t.svc.requestCard('r1', 'staff');
    const later = new Date((t.recs[0]!.createdAt as Date).getTime() + RECOVERY_WAIT_MS);
    return { ...t, token: t.docsToken(), later };
  }

  it('просят только с ЮKassa и если в аккаунте была карта; ссылка — своя', async () => {
    const off = setup({ payments: paid(), yookassa: false });
    await off.askNew();
    await expect(off.svc.requestCard('r1', 'staff')).rejects.toThrow(/ЮKassa/);
    const none = setup();
    await none.askNew();
    await expect(none.svc.requestCard('r1', 'staff')).rejects.toThrow(/не с чем/);

    const { svc, mail, token } = await asked();
    expect(mail.send).toHaveBeenLastCalledWith(
      'new@mail.x',
      expect.any(String),
      expect.stringMatching(/\/recover\/card\?token=/),
    );
    await expect(svc.cardStatus(token)).resolves.toEqual({ ok: true, state: 'open' });
    await expect(svc.dealsStatus(token)).rejects.toThrow(/недействительна/);
  });

  it('1 ₽ блокируется без списания, одна блокировка на ссылку; карта сверена — блокировка снята', async () => {
    const { svc, yookassa, holds, recs, token } = await asked();
    const first = await svc.cardPay(token);
    expect(yookassa.createHold).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100n,
        metadata: { purpose: 'recovery_card', recoveryId: 'r1' },
      }),
    );
    // Вернулся, не заплатив, — та же страница ЮKassa, вторая блокировка не нужна.
    await expect(svc.cardPay(token)).resolves.toEqual(first);
    expect(yookassa.createHold).toHaveBeenCalledTimes(1);
    await expect(svc.cardStatus(token)).resolves.toEqual({ ok: true, state: 'waiting' });
    bank(holds, 'h1', 'waiting_for_capture', MINE);
    await expect(svc.cardStatus(token)).resolves.toEqual({ ok: true, state: 'done' });
    await flush();
    expect(yookassa.cancel).toHaveBeenCalledWith('h1');
    expect(recs[0]!.cardResult).toMatchObject({ matched: true, source: 'payment', last4: '4477' });
    await expect(svc.cardPay(token)).rejects.toMatchObject({ status: 409 });
  });

  it('отклонённый банком платёж — не доказательство, попытку можно повторить', async () => {
    const { svc, yookassa, holds, recs, token } = await asked();
    await svc.cardPay(token);
    bank(holds, 'h1', 'canceled', MINE);
    await expect(svc.cardStatus(token)).resolves.toEqual({ ok: true, state: 'open', failed: true });
    expect(recs[0]!.cardCheckedAt ?? null).toBeNull();
    await svc.cardPay(token);
    expect(yookassa.createHold).toHaveBeenCalledTimes(2);
  });

  it('у старой оплаты карту спрашивают у ЮKassa и запоминают', async () => {
    const payments: PaidRow[] = [{ id: 'pay1', externalId: 'yk-old', card: null, createdAt: OLD }];
    const { svc, holds, recs, token, prisma } = await asked({ payments });
    holds.set('yk-old', { id: 'yk-old', status: 'succeeded', card: { ...MINE }, metadata: {} });
    await svc.cardPay(token);
    bank(holds, 'h1', 'waiting_for_capture', MINE);
    await svc.cardStatus(token);
    expect(recs[0]!.cardResult).toMatchObject({ matched: true });
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay1' },
      data: { card: MINE },
    });
  });

  it('на новую почту по карте — и без проверки личности, и при возражении; чужая или свежая карта — нельзя', async () => {
    const ok = await asked();
    await ok.svc.cardPay(ok.token);
    bank(ok.holds, 'h1', 'waiting_for_capture', MINE);
    await ok.svc.cardStatus(ok.token);
    await ok.svc.object('u1', 'r1', { userAgent: CHROME });
    await ok.svc.restoreToNewEmail('r1', 'staff', undefined, ok.later);
    expect(ok.recs[0]!.status).toBe('restored');
    expect(ok.mail.send).toHaveBeenCalledWith(
      'owner@e.x',
      expect.any(String),
      expect.stringMatching(/заплатил картой/),
    );
    expect(ok.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ after: expect.objectContaining({ proof: 'card' }) }),
    );

    const other = await asked();
    await other.svc.cardPay(other.token);
    bank(other.holds, 'h1', 'waiting_for_capture', { first6: '427600', last4: '1234' });
    await other.svc.cardStatus(other.token);
    await expect(
      other.svc.restoreToNewEmail('r1', 'staff', undefined, other.later),
    ).rejects.toThrow(/не совпала/);

    // Карту завели за 3 дня до заявки — мог и чужой, пока сидел в аккаунте.
    const fresh = await asked({ payments: paid(new Date(Date.now() - 3 * 86_400_000)) });
    await fresh.svc.cardPay(fresh.token);
    bank(fresh.holds, 'h1', 'waiting_for_capture', MINE);
    await fresh.svc.cardStatus(fresh.token);
    await expect(
      fresh.svc.restoreToNewEmail('r1', 'staff', undefined, fresh.later),
    ).rejects.toThrow(/2 недели/);
  });
});
