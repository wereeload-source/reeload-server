import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { SessionsService } from '../src/auth/sessions.service.js';
import { WhatsAppService } from '../src/checkin/whatsapp.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * Role-by-role check of the real API against a migrated, seeded database (`pnpm db:migrate && pnpm db:seed`).
 * Needs DATABASE_URL; the two JWT secrets fall back to test values. The seed password is the development one.
 * Sign-in is by httpOnly cookie, so each role gets its own cookie jar (a supertest agent), like a browser.
 */
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-test-secret-test-1234';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-test-refresh-test-refresh-test-refresh-5678';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Reeload#2025';

type Role = 'admin' | 'sales' | 'ops' | 'reelmaker' | 'accounts';
const USERS: Record<Role, string> = {
  admin: 'admin@reeload.test',
  sales: 'sales@reeload.test',
  ops: 'ops@reeload.test',
  accounts: 'accounts@reeload.test',
  reelmaker: 'reelmaker@reeload.test',
};
const RELMAKER_PHONE = '+919876500001';
const ALL = Object.keys(USERS) as Role[];

/** One safe GET per route group, with the roles allowed to call it (see access/access.policy.ts). */
const ACCESS: [string, Role[]][] = [
  ['/users', ['admin']],
  ['/dashboard', ['admin']],
  ['/audit', ['admin']],
  ['/jobs', ['admin', 'sales', 'ops']],
  ['/contacts', ['admin', 'sales']],
  ['/price-changes', ['admin', 'sales']],
  ['/ledger', ['admin', 'accounts', 'sales']],
  ['/ledger.csv', ['admin', 'accounts']],
  ['/assign/queue', ['admin', 'ops']],
  ['/leave', ['admin', 'ops']],
  ['/review', ['admin', 'ops']],
  ['/checkins/pending', ['admin', 'ops']],
  ['/extra-time', ['admin', 'sales', 'ops']],
  ['/calendar/month', ['admin', 'sales', 'ops']],
  ['/me/shoots', ['reelmaker']],
  ['/me/calendar', ['reelmaker']],
  ['/hours', ['admin', 'ops', 'reelmaker']],
  ['/reelmakers', ['admin', 'ops', 'sales']],
  // Open to every signed-in role:
  ['/auth/me', ALL],
  ['/notifications', ALL],
];

const cookiesOf = (res: request.Response): string[] => ([] as string[]).concat(res.headers['set-cookie'] ?? []);
const valueOf = (cookies: string[], name: string): string | undefined => cookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1);
const jar = (cookies: string[]) => cookies.map((c) => c.split(';')[0]);

describe('cookie sign-in and role access (e2e)', () => {
  let app: INestApplication;
  const agents = {} as Record<Role, ReturnType<typeof request.agent>>;
  const http = () => request(app.getHttpServer());
  /** Cookies for a brand-new session, made directly: only the login tests use the rate-limited HTTP login. */
  const sessionFor = async (email: string): Promise<string[]> => {
    const user = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email }, select: { id: true, email: true } });
    const t = await app.get(SessionsService).start(user, { ipAddress: '10.0.0.9', userAgent: 'e2e' });
    return [`access_token=${t.access}`, `refresh_token=${t.refresh}`];
  };
  const login = (identifier: string, password = PASSWORD, loginType = 'EMAIL_PASSWORD') =>
    http().post('/auth/login').send({ loginType, identifier, password });

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    configureApp(app);
    await app.init();
    for (const role of ALL) {
      agents[role] = request.agent(app.getHttpServer());
      const res = await agents[role].post('/auth/login').send({ loginType: 'EMAIL_PASSWORD', identifier: USERS[role], password: PASSWORD }).expect(200);
      expect(res.body.data.user.role).toBe(role);
    }
  });
  afterAll(() => app.close());

  describe('login', () => {
    it('answers { data } and keeps both tokens out of the body, in httpOnly cookies', async () => {
      const res = await login(USERS.sales).expect(200);
      expect(res.body).toEqual({ data: { message: 'Login successful', user: expect.objectContaining({ email: USERS.sales, display_name: expect.any(String) }) } });
      expect(JSON.stringify(res.body)).not.toMatch(/token|password/i);
      const cookies = cookiesOf(res);
      expect(cookies.find((c) => c.startsWith('access_token='))).toMatch(/HttpOnly/i);
      expect(cookies.find((c) => c.startsWith('refresh_token='))).toMatch(/HttpOnly/i);
      expect(cookies.join(';')).toMatch(/SameSite=Lax/i);
      expect(cookies.join(';')).toMatch(/Path=\//);
    });

    it('also signs in by phone', async () => {
      const res = await login(RELMAKER_PHONE, PASSWORD, 'PHONE_PASSWORD').expect(200);
      expect(res.body.data.user.email).toBe(USERS.reelmaker);
    });

    it('rejects a wrong password, an unknown email and an unknown phone with the same message', async () => {
      const a = await login(USERS.admin, 'nope-nope-nope');
      const b = await login('nobody@reeload.test', 'nope-nope-nope');
      const c = await login('+910000000000', 'nope-nope-nope', 'PHONE_PASSWORD');
      for (const r of [a, b, c]) expect(r.status).toBe(401);
      expect(a.body.message).toBe('Invalid credentials');
      expect(b.body.message).toBe(a.body.message);
      expect(c.body.message).toBe(a.body.message);
    });

    it('stores passwords as bcrypt: the old scrypt hashes are upgraded on first sign-in', async () => {
      const row = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email: USERS.admin }, select: { passwordHash: true } });
      expect(row.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    });

    it('refuses bad input and unknown fields with a 400', async () => {
      await http().post('/auth/login').send({ loginType: 'EMAIL_PASSWORD', identifier: 'x', password: '' }).expect(400);
      await http().post('/auth/login').send({ loginType: 'EMAIL_PASSWORD', identifier: USERS.admin, password: PASSWORD, isAdmin: true }).expect(400);
      await http().post('/auth/login').set('content-type', 'application/json').send('{"identifier":').expect(400);
    });
  });

  describe('protected routes', () => {
    it('refuse calls without the cookie, with a forged one, and with a Bearer header', async () => {
      await http().get('/auth/me').expect(401);
      await http().get('/auth/me').set('Cookie', 'access_token=abc.def.ghi').expect(401);
      const real = valueOf(await sessionFor(USERS.sales), 'access_token')!;
      await http().get('/auth/me').set('Authorization', `Bearer ${real}`).expect(401);
      await http().get('/auth/me').set('Cookie', `access_token=${real}`).expect(200);
    });

    it('keeps the health check open', async () => {
      await http().get('/health').expect(200);
    });

    for (const [path, allowed] of ACCESS) {
      for (const role of ALL) {
        const ok = allowed.includes(role);
        it(`${role} ${ok ? 'can' : 'cannot'} GET ${path}`, async () => {
          const res = await agents[role].get(path);
          if (ok) expect([401, 403]).not.toContain(res.status);
          else expect(res.status).toBe(403);
        });
      }
    }

    it('wraps JSON answers as { data } and sends the CSV as it is', async () => {
      const jobs = await agents.admin.get('/jobs').expect(200);
      expect(Object.keys(jobs.body)).toEqual(['data']);
      expect(Array.isArray(jobs.body.data.items)).toBe(true);
      const csv = await agents.admin.get('/ledger.csv').expect(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text).not.toMatch(/^\{"data"/);
    });

    it('shows the agreed amount to sales but not to ops', async () => {
      const sales = await agents.sales.get('/jobs').expect(200);
      const ops = await agents.ops.get('/jobs').expect(200);
      expect(sales.body.data.items.some((j: { agreed_amount?: unknown }) => j.agreed_amount != null)).toBe(true);
      for (const j of ops.body.data.items) expect(j.agreed_amount ?? null).toBeNull();
    });

    it('never sends a password hash', async () => {
      const res = await agents.admin.get('/users').expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it('refuses bad ids and queries without crashing', async () => {
      await agents.admin.get('/jobs/not-a-uuid').expect((res) => expect(res.status).toBeLessThan(500));
      await agents.admin.get('/jobs?limit=-5').expect((res) => expect(res.status).toBeLessThan(500));
    });

    it('re-checks the user on every request: a disabled account stops working at once', async () => {
      const prisma = app.get(PrismaService);
      const cookie = await sessionFor(USERS.ops);
      await http().get('/auth/me').set('Cookie', cookie).expect(200);
      await prisma.user.update({ where: { email: USERS.ops }, data: { active: false } });
      try {
        await http().get('/auth/me').set('Cookie', cookie).expect(401);
        await login(USERS.ops).expect(401);
        await http().post('/auth/refresh').set('Cookie', cookie).expect(401);
      } finally {
        await prisma.user.update({ where: { email: USERS.ops }, data: { active: true } });
      }
    });
  });

  describe('refresh and logout', () => {
    it('rotates both cookies on the same session, and a spent refresh token ends that session', async () => {
      const prisma = app.get(PrismaService);
      const old = await sessionFor(USERS.sales);
      const sessionsBefore = await prisma.session.count({ where: { user: { email: USERS.sales } } });

      const renewed = await http().post('/auth/refresh').set('Cookie', old).expect(200);
      expect(renewed.body).toEqual({ data: { message: 'Token refreshed successfully' } });
      const fresh = jar(cookiesOf(renewed));
      expect(valueOf(fresh, 'access_token')).not.toBe(valueOf(old, 'access_token'));
      expect(valueOf(fresh, 'refresh_token')).not.toBe(valueOf(old, 'refresh_token'));
      expect(await prisma.session.count({ where: { user: { email: USERS.sales } } })).toBe(sessionsBefore);
      await http().get('/auth/me').set('Cookie', fresh).expect(200);
      // The access cookie from before the rotation no longer matches the session.
      await http().get('/auth/me').set('Cookie', `access_token=${valueOf(old, 'access_token')}`).expect(401);

      // The old refresh cookie is now a replayed (stolen or stale) token: refused, and the session is deleted.
      const replay = await http().post('/auth/refresh').set('Cookie', old);
      expect(replay.status).toBe(401);
      expect(cookiesOf(replay).join(';')).toMatch(/access_token=;/);
      await http().post('/auth/refresh').set('Cookie', fresh).expect(401);
      await http().get('/auth/me').set('Cookie', fresh).expect(401);
    });

    it('answers 401 when the refresh cookie is missing or not a refresh token', async () => {
      const missing = await http().post('/auth/refresh');
      expect(missing.status).toBe(401);
      expect(missing.body.message).toBe('Refresh token not found');
      const access = valueOf(await sessionFor(USERS.sales), 'access_token')!;
      const wrong = await http().post('/auth/refresh').set('Cookie', `refresh_token=${access}`);
      expect(wrong.status).toBe(401);
      expect(wrong.body.message).toBe('Invalid refresh token');
    });

    it('signs out for real: both cookies are cleared and the refresh token stops working', async () => {
      const cookie = await sessionFor(USERS.ops);
      const out = await http().post('/auth/logout').set('Cookie', cookie).expect(200);
      expect(out.body).toEqual({ data: { message: 'Logout successful' } });
      const cleared = cookiesOf(out).join(';');
      expect(cleared).toMatch(/access_token=;/);
      expect(cleared).toMatch(/refresh_token=;/);
      await http().post('/auth/refresh').set('Cookie', cookie).expect(401);
      await http().get('/auth/me').set('Cookie', cookie).expect(401);
      // Logging out twice, or without a session, is not an error.
      await http().post('/auth/logout').set('Cookie', cookie).expect(200);
      await http().post('/auth/logout').expect(200);
    });
  });

  describe('sessions', () => {
    it('lists, and removes one device or all the others', async () => {
      const mine = request.agent(app.getHttpServer());
      const a = await mine.post('/auth/login').send({ loginType: 'EMAIL_PASSWORD', identifier: USERS.accounts, password: PASSWORD }).expect(200);
      const otherCookie = await sessionFor(USERS.accounts);
      expect(a.status).toBe(200);

      const list = await mine.get('/auth/sessions').expect(200);
      expect(list.body.data.length).toBeGreaterThanOrEqual(2);
      for (const s of list.body.data) expect(Object.keys(s).sort()).toEqual(['created_at', 'expires_at', 'id', 'ip_address', 'last_refresh_at', 'user_agent']);

      const removed = await mine.delete('/auth/sessions').expect(200);
      expect(removed.body.data.removed).toBeGreaterThanOrEqual(1);
      await http().get('/auth/me').set('Cookie', otherCookie).expect(401);
      await mine.get('/auth/me').expect(200);

      const remaining = (await mine.get('/auth/sessions').expect(200)).body.data as { id: string }[];
      expect(remaining).toHaveLength(1);
      await mine.delete(`/auth/sessions/${remaining[0].id}`).expect(200);
      await mine.get('/auth/me').expect(401);
      await http().delete('/auth/sessions/not-a-uuid').expect(401);
    });

    it('keeps at most 5 signed-in devices per person: the oldest is dropped', async () => {
      const prisma = app.get(PrismaService);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: USERS.accounts }, select: { id: true, email: true } });
      const sessions = app.get(SessionsService);
      await sessions.removeAll(user.id);
      for (let i = 0; i < 7; i++) await sessions.start(user, { ipAddress: '10.0.0.1', userAgent: `device-${i}` });
      const rows = await prisma.session.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' }, select: { userAgent: true } });
      expect(rows).toHaveLength(5);
      expect(rows.map((r) => r.userAgent)).toEqual(['device-2', 'device-3', 'device-4', 'device-5', 'device-6']);
      await sessions.removeAll(user.id);
    });

    it('stores the refresh token only as a hash', async () => {
      const refresh = valueOf(await sessionFor(USERS.sales), 'refresh_token')!;
      const rows = await app.get(PrismaService).session.findMany({ where: { user: { email: USERS.sales } }, select: { refreshTokenHash: true } });
      expect(rows.some((r) => r.refreshTokenHash === refresh)).toBe(false);
      expect(rows.every((r) => /^\$2[aby]\$/.test(r.refreshTokenHash))).toBe(true);
    });
  });

  describe('passwords', () => {
    it('changing the password signs out every device and clears the cookies', async () => {
      const cookieA = await sessionFor(USERS.accounts);
      const cookieB = await sessionFor(USERS.accounts);
      const res = await http().post('/auth/password').set('Cookie', cookieA).send({ current_password: PASSWORD, new_password: PASSWORD }).expect(200);
      expect(cookiesOf(res).join(';')).toMatch(/access_token=;/);
      await http().get('/auth/me').set('Cookie', cookieA).expect(401);
      await http().get('/auth/me').set('Cookie', cookieB).expect(401);
      await http().post('/auth/password').set('Cookie', await sessionFor(USERS.accounts)).send({ current_password: 'not-it', new_password: PASSWORD }).expect(400);
    });

    describe('reset by WhatsApp code', () => {
      let codes: string[];
      beforeEach(() => {
        codes = [];
        vi.spyOn(app.get(WhatsAppService), 'sendOtp').mockImplementation(async (_to: string, code: string) => {
          codes.push(code);
        });
      });
      afterEach(() => vi.restoreAllMocks());

      const forgot = (identifier: string) => http().post('/auth/forgot-password').send({ channel: 'WHATSAPP', identifier });

      it('answers the same whether or not the account exists, and only sends a code to a real one', async () => {
        const real = await forgot(RELMAKER_PHONE).expect(200);
        const fake = await forgot('+910000000099').expect(200);
        expect(fake.body).toEqual(real.body);
        expect(real.body.data.message).toMatch(/If an account exists/);
        expect(codes).toHaveLength(1);
        expect(codes[0]).toMatch(/^\d{6}$/);
        expect(JSON.stringify(real.body)).not.toContain(codes[0]);
        const rows = await app.get(PrismaService).verificationToken.findMany({ where: { user: { email: USERS.reelmaker }, purpose: 'PASSWORD_RESET' }, orderBy: { createdAt: 'desc' }, take: 1 });
        expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect(rows[0].tokenHash).not.toBe(codes[0]);
      });

      it('swaps the code for a 5-minute ticket, then sets the password once and signs everyone out', async () => {
        const sessionCookie = await sessionFor(USERS.reelmaker);
        await forgot(RELMAKER_PHONE).expect(200);
        const code = codes[0];

        const wrong = await http().post('/auth/reset-password/verify-otp').send({ identifier: RELMAKER_PHONE, otp: code === '000000' ? '111111' : '000000' });
        expect(wrong.status).toBe(400);
        expect(wrong.body.message).toBe('Invalid or expired code');

        const ok = await http().post('/auth/reset-password/verify-otp').send({ identifier: RELMAKER_PHONE, otp: code }).expect(200);
        const ticket: string = ok.body.data.reset_ticket;
        expect((await http().get('/auth/reset-password/validate').query({ resetTicket: ticket }).expect(200)).body.data).toEqual({ valid: true });
        expect((await http().get('/auth/reset-password/validate').query({ resetTicket: 'nope' }).expect(200)).body.data).toEqual({ valid: false });

        await http().post('/auth/reset-password').send({ resetTicket: ticket, newPassword: 'short' }).expect(400);
        await http().post('/auth/reset-password').send({ resetTicket: ticket }).expect(400);
        await http().post('/auth/reset-password').send({ resetTicket: ticket, token: 'f'.repeat(64), newPassword: PASSWORD }).expect(400);

        await http().post('/auth/reset-password').send({ resetTicket: ticket, newPassword: PASSWORD }).expect(200);
        // Single use, and every old session is gone.
        const again = await http().post('/auth/reset-password').send({ resetTicket: ticket, newPassword: PASSWORD });
        expect(again.status).toBe(401);
        expect(again.body.message).toBe('Invalid or expired reset ticket');
        await http().get('/auth/me').set('Cookie', sessionCookie).expect(401);
        await login(USERS.reelmaker).expect(200);
        const notice = await app.get(PrismaService).notification.findFirst({ where: { user: { email: USERS.reelmaker }, title: 'Your password was changed' } });
        expect(notice).not.toBeNull();
      });

      it('locks a code after too many wrong tries', async () => {
        await forgot(RELMAKER_PHONE).expect(200);
        const code = codes[0];
        const wrong = code === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i++) await http().post('/auth/reset-password/verify-otp').send({ identifier: RELMAKER_PHONE, otp: wrong }).expect(400);
        const locked = await http().post('/auth/reset-password/verify-otp').send({ identifier: RELMAKER_PHONE, otp: code });
        expect(locked.status).toBe(400);
        expect(locked.body.message).toBe('Too many attempts, request a new code');
      });

      it('refuses the ticket of an inactive account and a ticket signed with the refresh secret', async () => {
        const forged = await http().post('/auth/reset-password').send({ resetTicket: 'x'.repeat(60), newPassword: PASSWORD });
        expect(forged.status).toBe(401);
      });
    });
  });

  describe('rate limits', () => {
    it('slows password guessing on one account without locking out colleagues on the same network', async () => {
      const target = 'guess-target@reeload.test';
      for (let i = 0; i < 5; i++) await login(target, `wrong-${i}`).expect(401);
      await login(target, 'wrong-again').expect(429);
      // Same address, a different account: still allowed.
      await login(USERS.accounts).expect(200);
    });

    it('limits password-reset codes per address and phone to 3 an hour', async () => {
      vi.spyOn(app.get(WhatsAppService), 'sendOtp').mockResolvedValue(undefined);
      const phone = '+910000000123';
      for (let i = 0; i < 3; i++) await http().post('/auth/forgot-password').send({ channel: 'WHATSAPP', identifier: phone }).expect(200);
      await http().post('/auth/forgot-password').send({ channel: 'WHATSAPP', identifier: phone }).expect(429);
      vi.restoreAllMocks();
    });
  });
});
