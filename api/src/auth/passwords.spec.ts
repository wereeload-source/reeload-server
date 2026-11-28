import { scryptSync, randomBytes } from 'node:crypto';
import { Passwords, sameHash, sha256 } from './passwords.js';

/** A hash in the format the old @nestjs/authentication library wrote. */
function legacyHash(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(Buffer.from(password.normalize('NFKC')), salt, 32, { N: 2 ** 14, r: 8, p: 1 });
  const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
  return `$scrypt$ln=14,r=8,p=1$${b64(salt)}$${b64(key)}`;
}

describe('Passwords', () => {
  const passwords = new Passwords();

  it('hashes with bcrypt and never keeps the password', async () => {
    const hash = await passwords.hash('Reeload#2025');
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(hash).not.toContain('Reeload');
    expect(await passwords.verify('Reeload#2025', hash)).toBe(true);
    expect(await passwords.verify('wrong', hash)).toBe(false);
  });

  it('still accepts passwords stored in the old scrypt format, and asks for them to be upgraded', async () => {
    const old = legacyHash('Reeload#2025');
    expect(await passwords.verify('Reeload#2025', old)).toBe(true);
    expect(await passwords.verify('nope', old)).toBe(false);
    expect(passwords.needsUpgrade(old)).toBe(true);
    expect(passwords.needsUpgrade(await passwords.hash('x'))).toBe(false);
  });

  it('takes the same path for a missing account (no hash) and refuses', async () => {
    expect(await passwords.verify('anything', undefined)).toBe(false);
    expect(await passwords.verify('anything', 'not-a-hash')).toBe(false);
  });
});

describe('why refresh tokens are digested before bcrypt', () => {
  const passwords = new Passwords();

  it('bcrypt ignores everything after 72 bytes, so two long tokens that start alike would match', async () => {
    const a = `${'x'.repeat(72)}A`;
    const b = `${'x'.repeat(72)}B`;
    expect(await passwords.verify(b, await passwords.hash(a))).toBe(true);
  });

  it('hashing the sha256 digest tells them apart', async () => {
    const a = `${'x'.repeat(72)}A`;
    const b = `${'x'.repeat(72)}B`;
    expect(await passwords.verify(sha256(b), await passwords.hash(sha256(a)))).toBe(false);
    expect(await passwords.verify(sha256(a), await passwords.hash(sha256(a)))).toBe(true);
  });
});

describe('sha256 comparison', () => {
  it('matches equal digests only', () => {
    expect(sameHash(sha256('123456'), sha256('123456'))).toBe(true);
    expect(sameHash(sha256('123456'), sha256('123457'))).toBe(false);
    expect(sameHash(sha256('123456'), 'abcd')).toBe(false);
    expect(sameHash('', '')).toBe(false);
  });
});
