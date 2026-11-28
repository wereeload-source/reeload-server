import { validateEnv } from './env.js';

const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'a'.repeat(64), HASH_PEPPER: 'b'.repeat(64) };

describe('validateEnv', () => {
  it('allows the local storage stand-in in development', () => {
    expect(validateEnv({ ...base, R2_ENDPOINT: 'http://127.0.0.1:9100' }).R2_ENDPOINT).toBe('http://127.0.0.1:9100');
  });

  it('refuses the local storage stand-in in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', R2_ENDPOINT: 'http://127.0.0.1:9100' })).toThrow(/local development only/);
  });
});
