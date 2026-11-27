import { signToken, verifyToken } from './jwt.js';

const SECRET = 'a-test-secret-that-is-long-enough-123456';
const ID = '00000000-0000-0000-0000-000000000001';
const now = Date.UTC(2026, 10, 28, 12, 0, 0);

describe('login tokens', () => {
  it('round-trips the user id', () => {
    const token = signToken(ID, SECRET, 3600, now);
    expect(verifyToken(token, SECRET, now + 1000)?.sub).toBe(ID);
  });

  it('refuses an expired token', () => {
    const token = signToken(ID, SECRET, 3600, now);
    expect(verifyToken(token, SECRET, now + 3600 * 1000)).toBeNull();
    expect(verifyToken(token, SECRET, now + 3599 * 1000)).not.toBeNull();
  });

  it('refuses a token signed with another secret', () => {
    const token = signToken(ID, 'another-secret-another-secret-123456', 3600, now);
    expect(verifyToken(token, SECRET, now)).toBeNull();
  });

  it('refuses a token whose body was changed', () => {
    const [h, , s] = signToken(ID, SECRET, 3600, now).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'someone-else', iat: 0, exp: 9999999999 })).toString('base64url');
    expect(verifyToken(`${h}.${forged}.${s}`, SECRET, now)).toBeNull();
  });

  it('refuses alg=none and other headers', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: ID, iat: 0, exp: 9999999999 })).toString('base64url');
    expect(verifyToken(`${header}.${body}.`, SECRET, now)).toBeNull();
    expect(verifyToken(`${header}.${body}.x`, SECRET, now)).toBeNull();
  });

  it('refuses junk', () => {
    expect(verifyToken('', SECRET, now)).toBeNull();
    expect(verifyToken('a.b', SECRET, now)).toBeNull();
    expect(verifyToken('not a token at all', SECRET, now)).toBeNull();
  });
});
