import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';

/** The routes that check a password. Only these use the tight per-account limit. */
const PASSWORD_ROUTES = new Set(['POST /auth/login']);

const isPasswordRoute = (ctx: ExecutionContext): boolean => {
  const req = ctx.switchToHttp().getRequest<{ method?: string; route?: { path?: string } }>();
  return PASSWORD_ROUTES.has(`${req.method} ${req.route?.path}`);
};

/** The email being tried, normalised the same way the login schema does. */
export function loginTracker(req: Record<string, any>): string {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 200) : '';
  return `${req.ip}|${email}`;
}

/**
 * - `default`: every route, 300 requests a minute per address.
 * - `login`: 5 password tries per 15 minutes for one account from one address, so guessing one
 *   account's password is slow, while colleagues behind the same office Wi-Fi are not locked out.
 * - `login-ip`: 30 tries per 15 minutes per address across all accounts, against spraying many emails.
 */
export const THROTTLERS: ThrottlerOptions[] = [
  { name: 'default', ttl: 60_000, limit: 300 },
  { name: 'login', ttl: 15 * 60_000, limit: 5, getTracker: loginTracker, skipIf: (ctx) => !isPasswordRoute(ctx) },
  { name: 'login-ip', ttl: 15 * 60_000, limit: 30, skipIf: (ctx) => !isPasswordRoute(ctx) },
];
