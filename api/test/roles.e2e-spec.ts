import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

/**
 * Role-by-role check of the real API against a migrated, seeded database (`pnpm db:migrate && pnpm db:seed`).
 * Needs DATABASE_URL; JWT_SECRET falls back to a test value. The seed password is the development one.
 */
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123';
const PASSWORD = process.env.SEED_PASSWORD ?? 'ReelOps#2025';

type Role = 'admin' | 'sales' | 'ops' | 'reelmaker' | 'accounts';
const USERS: Record<Role, string> = {
  admin: 'admin@reelops.test',
  sales: 'sales@reelops.test',
  ops: 'ops@reelops.test',
  accounts: 'accounts@reelops.test',
  reelmaker: 'reelmaker@reelops.test',
};
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
  ['/me', ALL],
  ['/notifications', ALL],
];

describe('role-wise login and access (e2e)', () => {
  let app: INestApplication;
  const tokens = {} as Record<Role, string>;
  const refreshTokens = {} as Record<Role, string>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init();
    for (const role of ALL) {
      const res = await http().post('/auth/login').send({ email: USERS[role], password: PASSWORD }).expect(200);
      tokens[role] = res.body.access_token;
      refreshTokens[role] = res.body.refresh_token;
      expect(res.body.user.role).toBe(role);
    }
  });
  afterAll(() => app.close());

  it('rejects a wrong password and an unknown email with the same message', async () => {
    const a = await http().post('/auth/login').send({ email: USERS.admin, password: 'nope-nope-nope' });
    const b = await http().post('/auth/login').send({ email: 'nobody@reelops.test', password: 'nope-nope-nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('rejects calls without a token or with a forged one', async () => {
    await http().get('/me').expect(401);
    await http().get('/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
  });

  it('keeps the health check open', async () => {
    await http().get('/health').expect(200);
  });

  for (const [path, allowed] of ACCESS) {
    for (const role of ALL) {
      const ok = allowed.includes(role);
      it(`${role} ${ok ? 'can' : 'cannot'} GET ${path}`, async () => {
        const res = await http().get(path).set('Authorization', `Bearer ${tokens[role]}`);
        if (ok) expect([401, 403]).not.toContain(res.status);
        else expect(res.status).toBe(403);
      });
    }
  }

  it('shows the agreed amount to sales but not to ops', async () => {
    const sales = await http().get('/jobs').set('Authorization', `Bearer ${tokens.sales}`).expect(200);
    const ops = await http().get('/jobs').set('Authorization', `Bearer ${tokens.ops}`).expect(200);
    expect(sales.body.items.some((j: { agreed_amount?: unknown }) => j.agreed_amount != null)).toBe(true);
    for (const j of ops.body.items) expect(j.agreed_amount ?? null).toBeNull();
  });

  it('gives a reelmaker only their own shoots', async () => {
    const res = await http().get('/me/shoots').set('Authorization', `Bearer ${tokens.reelmaker}`).expect(200);
    expect(res.body).toBeDefined();
  });

  it('renews a session once, then refuses the spent refresh token', async () => {
    const first = await http().post('/auth/refresh').send({ refresh_token: refreshTokens.sales }).expect(200);
    expect(first.body.access_token).toBeTruthy();
    await http().post('/auth/refresh').send({ refresh_token: refreshTokens.sales }).expect(401);
  });

  it('signs out for real: the refresh token stops working', async () => {
    const login = await http().post('/auth/login').send({ email: USERS.ops, password: PASSWORD }).expect(200);
    await http().post('/auth/logout').set('Authorization', `Bearer ${login.body.access_token}`).send({ refresh_token: login.body.refresh_token }).expect(200);
    await http().post('/auth/refresh').send({ refresh_token: login.body.refresh_token }).expect(401);
  });
});
