import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env.js';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

/** "15m", "7d", "12h", "30s" in milliseconds. */
export function lifetimeMs(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) throw new Error(`Not a lifetime: ${ttl}`);
  return Number(m[1]) * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

/**
 * Sets and clears the two sign-in cookies. Clearing uses exactly the same httpOnly, secure,
 * sameSite, path and domain as setting, or the browser would keep the cookie.
 */
@Injectable()
export class AuthCookies {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private base(): CookieOptions {
    const domain = this.config.get('COOKIE_DOMAIN', { infer: true });
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
      sameSite: this.config.get('COOKIE_SAME_SITE', { infer: true }),
      path: this.config.get('COOKIE_PATH', { infer: true }),
      ...(domain ? { domain } : {}),
    };
  }

  set(res: Response, tokens: { access: string; refresh: string }): void {
    res.cookie(ACCESS_COOKIE, tokens.access, { ...this.base(), maxAge: lifetimeMs(this.config.get('ACCESS_TOKEN_TTL', { infer: true })) });
    res.cookie(REFRESH_COOKIE, tokens.refresh, { ...this.base(), maxAge: lifetimeMs(this.config.get('REFRESH_TOKEN_TTL', { infer: true })) });
  }

  clear(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, this.base());
    res.clearCookie(REFRESH_COOKIE, this.base());
  }
}
