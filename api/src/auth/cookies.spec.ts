import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ACCESS_COOKIE, AuthCookies, lifetimeMs, REFRESH_COOKIE } from './cookies.js';

const config = (values: Record<string, unknown>) => ({ get: (k: string) => values[k] }) as unknown as ConfigService<never, true>;
const settings = { ACCESS_TOKEN_TTL: '15m', REFRESH_TOKEN_TTL: '7d', COOKIE_SECURE: true, COOKIE_SAME_SITE: 'none', COOKIE_PATH: '/', COOKIE_DOMAIN: 'example.com' };

function fakeResponse() {
  const cookie = vi.fn();
  const clearCookie = vi.fn();
  return { res: { cookie, clearCookie } as unknown as Response, cookie, clearCookie };
}

describe('lifetimeMs', () => {
  it('reads 15m, 7d, 12h and 30s', () => {
    expect(lifetimeMs('15m')).toBe(900_000);
    expect(lifetimeMs('7d')).toBe(604_800_000);
    expect(lifetimeMs('12h')).toBe(43_200_000);
    expect(lifetimeMs('30s')).toBe(30_000);
    expect(() => lifetimeMs('soon')).toThrow();
  });
});

describe('AuthCookies', () => {
  it('sets both cookies httpOnly with the configured flags and each token\'s own lifetime', () => {
    const { res, cookie } = fakeResponse();
    new AuthCookies(config(settings)).set(res, { access: 'A', refresh: 'R' });
    const flags = { httpOnly: true, secure: true, sameSite: 'none', path: '/', domain: 'example.com' };
    expect(cookie).toHaveBeenCalledWith(ACCESS_COOKIE, 'A', { ...flags, maxAge: 900_000 });
    expect(cookie).toHaveBeenCalledWith(REFRESH_COOKIE, 'R', { ...flags, maxAge: 604_800_000 });
  });

  it('clears with exactly the same flags, or the browser would keep the cookies', () => {
    const { res, cookie, clearCookie } = fakeResponse();
    const cookies = new AuthCookies(config(settings));
    cookies.set(res, { access: 'A', refresh: 'R' });
    cookies.clear(res);
    const setFlags = (name: string) => {
      const { maxAge: _age, ...flags } = cookie.mock.calls.find((c) => c[0] === name)![2] as Record<string, unknown>;
      return flags;
    };
    expect(clearCookie).toHaveBeenCalledWith(ACCESS_COOKIE, setFlags(ACCESS_COOKIE));
    expect(clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE, setFlags(REFRESH_COOKIE));
  });

  it('leaves the domain out when none is configured', () => {
    const { res, cookie } = fakeResponse();
    new AuthCookies(config({ ...settings, COOKIE_DOMAIN: undefined, COOKIE_SAME_SITE: 'lax', COOKIE_SECURE: false })).set(res, { access: 'A', refresh: 'R' });
    expect(cookie.mock.calls[0][2]).not.toHaveProperty('domain');
    expect(cookie.mock.calls[0][2]).toMatchObject({ httpOnly: true, secure: false, sameSite: 'lax' });
  });
});
