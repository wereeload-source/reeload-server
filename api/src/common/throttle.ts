import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';

type Req = { method?: string; route?: { path?: string }; ip?: string; body?: Record<string, unknown> };

const routeIs = (ctx: ExecutionContext, route: string): boolean => {
  const req = ctx.switchToHttp().getRequest<Req>();
  return `${req.method} ${req.route?.path}` === route;
};

const identifierOf = (req: Req): string => {
  const v = req.body?.identifier;
  return typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s()-]/g, '').slice(0, 200) : '';
};

/** The account being tried from this address, normalised the way login normalises it. */
export function loginTracker(req: Record<string, any>): string {
  return `${req.ip}|${identifierOf(req)}`;
}

/** Password-reset requests per address and phone. */
export const forgotTracker = loginTracker;

/**
 * - `default`: every route, 300 requests a minute per address.
 * - `login`: 5 password tries per 15 minutes for one account from one address, so guessing one
 *   account's password is slow, while colleagues behind the same office Wi-Fi are not locked out.
 * - `login-ip`: 30 tries per 15 minutes per address across all accounts, against spraying many accounts.
 * - `forgot`: password-reset codes per address and phone per hour (PASSWORD_RESET_RATE_LIMIT_PER_HOUR).
 */
export function throttlers(forgotPerHour: number): ThrottlerOptions[] {
  return [
    { name: 'default', ttl: 60_000, limit: 300 },
    { name: 'login', ttl: 15 * 60_000, limit: 5, getTracker: loginTracker, skipIf: (ctx) => !routeIs(ctx, 'POST /auth/login') },
    { name: 'login-ip', ttl: 15 * 60_000, limit: 30, skipIf: (ctx) => !routeIs(ctx, 'POST /auth/login') },
    { name: 'forgot', ttl: 60 * 60_000, limit: forgotPerHour, getTracker: forgotTracker, skipIf: (ctx) => !routeIs(ctx, 'POST /auth/forgot-password') },
  ];
}
