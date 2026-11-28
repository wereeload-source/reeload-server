import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://x',
  JWT_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'r'.repeat(64),
  HASH_PEPPER: 'b'.repeat(64),
};
const production = { ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' };

describe('validateEnv', () => {
  it('allows the local storage stand-in in development', () => {
    expect(validateEnv({ ...base, R2_ENDPOINT: 'http://127.0.0.1:9100' }).R2_ENDPOINT).toBe('http://127.0.0.1:9100');
  });

  it('refuses the local storage stand-in in production', () => {
    expect(() => validateEnv({ ...production, R2_ENDPOINT: 'http://127.0.0.1:9100' })).toThrow(/local development only/);
  });

  it('uses the spec defaults for lifetimes and cookies', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({ ACCESS_TOKEN_TTL: '15m', REFRESH_TOKEN_TTL: '7d', COOKIE_SECURE: false, COOKIE_SAME_SITE: 'lax', COOKIE_PATH: '/' });
    expect(env.COOKIE_DOMAIN).toBeUndefined();
  });

  it('refuses to start without both secrets, or with short or identical ones', () => {
    expect(() => validateEnv({ ...base, JWT_REFRESH_SECRET: undefined })).toThrow(/JWT_REFRESH_SECRET/);
    expect(() => validateEnv({ ...base, JWT_SECRET: 'a'.repeat(47) })).toThrow(/at least 48/);
    expect(() => validateEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_SECRET })).toThrow(/different/);
  });

  it('treats empty values as not set', () => {
    expect(validateEnv({ ...base, COOKIE_DOMAIN: '', COOKIE_SAME_SITE: '' }).COOKIE_SAME_SITE).toBe('lax');
  });

  it('wants secure cookies with SameSite=none and in production', () => {
    expect(() => validateEnv({ ...base, COOKIE_SAME_SITE: 'none' })).toThrow(/COOKIE_SECURE/);
    expect(validateEnv({ ...base, COOKIE_SAME_SITE: 'none', COOKIE_SECURE: 'true' }).COOKIE_SAME_SITE).toBe('none');
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/COOKIE_SECURE/);
  });

  it('allows the fixed check-in test code in development only, and only as six digits', () => {
    expect(validateEnv({ ...base, CHECKIN_TEST_CODE: '111111' }).CHECKIN_TEST_CODE).toBe('111111');
    expect(() => validateEnv({ ...base, CHECKIN_TEST_CODE: '1234' })).toThrow(/six digits/);
    expect(() => validateEnv({ ...production, CHECKIN_TEST_CODE: '111111' })).toThrow(/development only/);
  });

  it('reads comma-separated frontend origins and refuses paths', () => {
    expect(validateEnv({ ...base, FRONTEND_URL: 'https://app.example.com/, http://localhost:3000' }).FRONTEND_URL).toEqual([
      'https://app.example.com',
      'http://localhost:3000',
    ]);
    expect(() => validateEnv({ ...base, FRONTEND_URL: 'https://app.example.com/login' })).toThrow(/origins/);
  });
});
