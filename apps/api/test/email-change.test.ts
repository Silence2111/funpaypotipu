import { beforeAll, describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { EmailChangeService, emailReserved } from '../src/modules/auth/email-change.service';
import { TokenService } from '../src/modules/auth/token.service';

/**
 * Смена почты: с паролем и кодом из приложения, сменится — только по ссылке
 * с новой почты; старой — «Это не я» на 7 дней: почта возвращается, пароль
 * новый, всё, что мог завести сменивший, сбрасывается.
 */

type Row = Record<string, unknown>;
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const DAY = 86_400_000;

const PASSWORD = 'password123';
/** bcrypt-хеш пароля с малой стоимостью — для скорости. */
let HASH = '';

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'access-secret';
  HASH = await bcrypt.hash(PASSWORD, 4);
});

const same = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Простые условия Prisma: равенство, equals без регистра, not и gt по датам. */
const fits = (r: Row, where: Row) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const c = v as { equals?: string; not?: unknown; gt?: Date };
      if (c.equals !== undefined) return same(r[k], c.equals);
      if (c.not !== undefined) return r[k] !== c.not;
      if (c.gt) return (r[k] as Date | null)?.getTime() > c.gt.getTime();
      return true;
    }
    return (r[k] ?? null) === v;
  });

function setup(opts: { twoFactor?: boolean; others?: string[] } = {}) {
  const user: Row = {
    id: 'u1',
    email: 'old@e.x',
    passwordHash: HASH,
    locale: 'ru',
  };
  const users: Row[] = [user, ...(opts.others ?? []).map((e, i) => ({ id: `o${i}`, email: e }))];
  const changes: Row[] = [];
  const cleared: string[] = [];
  const prisma = {
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          users.find((u) => u.id === where.id) ?? null,
      ),
      count: vi.fn(async ({ where }: { where: Row }) => users.filter((u) => fits(u, where)).length),
      update: vi.fn(async ({ data }: { data: Row }) => Object.assign(user, data)),
    },
    emailChange: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: `c${changes.length + 1}`,
          status: 'pending',
          createdAt: new Date(),
          confirmedAt: null,
          ...data,
        };
        changes.push(row);
        return row;
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          changes.find((c) => c.id === where.id) ?? null,
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hit = changes.filter((c) => fits(c, where));
        hit.forEach((c) => Object.assign(c, data));
        return { count: hit.length };
      }),
      count: vi.fn(
        async ({ where }: { where: Row }) => changes.filter((c) => fits(c, where)).length,
      ),
    },
    twoFactor: { deleteMany: vi.fn(async () => (cleared.push('twoFactor'), { count: 1 })) },
    socialAccount: { deleteMany: vi.fn(async () => (cleared.push('social'), { count: 1 })) },
    pushSubscription: { deleteMany: vi.fn(async () => (cleared.push('push'), { count: 1 })) },
    authSession: { deleteMany: vi.fn(async () => (cleared.push('sessions'), { count: 2 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const twofactor = {
    check: vi.fn(async (_u: string, code?: string) =>
      !opts.twoFactor ? 'ok' : code === '123456' ? 'ok' : code ? 'invalid' : 'required',
    ),
  };
  const mail = { enabled: true, send: vi.fn(async () => undefined) };
  const audit = { log: vi.fn(async () => undefined) };
  const notifications = { notify: vi.fn(async () => undefined) };
  const moduleRef = { get: () => notifications };
  const svc = new EmailChangeService(
    prisma as never,
    new TokenService(new JwtService()),
    twofactor as never,
    mail as never,
    audit as never,
    moduleRef as never,
  );
  /** Токен из последнего письма на этот адрес. */
  const tokenTo = (to: string) => {
    const call = (mail.send.mock.calls as unknown as Array<[string, string, string]>)
      .filter((c) => c[0] === to)
      .at(-1)!;
    return decodeURIComponent(/token=([^\s]+)/.exec(call[2])![1]!);
  };
  const ctx = { userAgent: CHROME, ip: '198.51.100.7' };
  return { svc, prisma, user, changes, cleared, mail, audit, notifications, tokenTo, ctx };
}

describe('смена почты', () => {
  it('просят с паролем и кодом из приложения; та же или занятая почта — отказ; письмо — на новую', async () => {
    const { svc, user, mail, ctx } = setup({ twoFactor: true, others: ['taken@e.x'] });
    await expect(svc.request('u1', { email: 'new@e.x', password: 'wrong' }, ctx)).rejects.toThrow(
      /Текущий пароль/,
    );
    await expect(
      svc.request('u1', { email: 'new@e.x', password: PASSWORD }, ctx),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      svc.request('u1', { email: 'OLD@e.x', password: PASSWORD, code: '123456' }, ctx),
    ).rejects.toThrow(/Это и есть/);
    await expect(
      svc.request('u1', { email: 'Taken@E.x', password: PASSWORD, code: '123456' }, ctx),
    ).rejects.toMatchObject({ status: 409 });
    await svc.request('u1', { email: ' New@E.x ', password: PASSWORD, code: '123456' }, ctx);
    expect(mail.send).toHaveBeenLastCalledWith(
      'new@e.x',
      expect.any(String),
      expect.stringMatching(/\/email\/confirm\?token=/),
    );
    expect(user.email).toBe('old@e.x');
  });

  it('по ссылке с новой почты — почта сменена и подтверждена; старой — «Это не я» на 7 дней', async () => {
    const { svc, user, changes, mail, audit, notifications, tokenTo, ctx } = setup();
    await svc.request('u1', { email: 'new@e.x', password: PASSWORD }, ctx);
    const token = tokenTo('new@e.x');
    await expect(svc.confirm(token)).resolves.toEqual({ ok: true, email: 'new@e.x' });
    expect(user).toMatchObject({ email: 'new@e.x', emailVerified: expect.any(Date) });
    expect(changes[0]!.status).toBe('done');
    expect(mail.send).toHaveBeenCalledWith(
      'old@e.x',
      expect.any(String),
      expect.stringMatching(
        /n\*\*\*@e\.x: Chrome · Windows, IP 198\.51\.100\.7.*\/email\/revert\?token=/s,
      ),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.change', before: { email: 'old@e.x' } }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect((notifications.notify.mock.calls.at(-1) as unknown as [string, string])[1]).toBe(
      'email_changed',
    );
    await expect(svc.confirm(token)).rejects.toThrow(/недействительна/);
  });

  it('новая просьба гасит ссылку из прошлого письма', async () => {
    const { svc, user, tokenTo, ctx } = setup();
    await svc.request('u1', { email: 'first@e.x', password: PASSWORD }, ctx);
    const first = tokenTo('first@e.x');
    await svc.request('u1', { email: 'second@e.x', password: PASSWORD }, ctx);
    await expect(svc.confirm(first)).rejects.toThrow(/недействительна/);
    await svc.confirm(tokenTo('second@e.x'));
    expect(user.email).toBe('second@e.x');
  });

  it('«Это не я»: почта прежняя, пароль новый, сеансы, вход с кодом и сервисы сброшены; второй раз — нельзя', async () => {
    const { svc, user, changes, cleared, audit, tokenTo, ctx } = setup();
    await svc.request('u1', { email: 'new@e.x', password: PASSWORD }, ctx);
    await svc.confirm(tokenTo('new@e.x'));
    const revert = tokenTo('old@e.x');
    await expect(svc.revertStatus(revert)).resolves.toMatchObject({ ok: true, email: 'n***@e.x' });
    await svc.revert(revert, 'brand-new-pass');
    expect(user).toMatchObject({ email: 'old@e.x', telegramId: null });
    expect(user.passwordHash).not.toBe(HASH);
    expect(cleared).toEqual(['twoFactor', 'social', 'push', 'sessions']);
    expect(changes[0]!.status).toBe('reverted');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'email.revert' }));
    await expect(svc.revert(revert, 'brand-new-pass')).rejects.toThrow(/недействительна/);
  });

  it('через 7 дней или после новой смены «Это не я» не действует', async () => {
    const late = setup();
    await late.svc.request('u1', { email: 'new@e.x', password: PASSWORD }, late.ctx);
    await late.svc.confirm(late.tokenTo('new@e.x'));
    late.changes[0]!.confirmedAt = new Date(Date.now() - 8 * DAY);
    await expect(late.svc.revertStatus(late.tokenTo('old@e.x'))).rejects.toThrow(/недействительна/);

    const again = setup();
    await again.svc.request('u1', { email: 'new@e.x', password: PASSWORD }, again.ctx);
    await again.svc.confirm(again.tokenTo('new@e.x'));
    const first = again.tokenTo('old@e.x');
    await again.svc.request('u1', { email: 'third@e.x', password: PASSWORD }, again.ctx);
    await again.svc.confirm(again.tokenTo('third@e.x'));
    await expect(again.svc.revert(first, 'brand-new-pass')).rejects.toThrow(/недействительна/);
  });

  it('пока «Это не я» действует, прежнюю почту не занять другому аккаунту', async () => {
    const { svc, prisma, user, tokenTo, ctx } = setup();
    await svc.request('u1', { email: 'new@e.x', password: PASSWORD }, ctx);
    await svc.confirm(tokenTo('new@e.x'));
    await expect(emailReserved(prisma as never, 'OLD@e.x')).resolves.toBe(true);
    await expect(emailReserved(prisma as never, 'OLD@e.x', 'u1')).resolves.toBe(false);
    await expect(emailReserved(prisma as never, 'other@e.x')).resolves.toBe(false);
  });
});
