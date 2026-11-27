import {
  type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PROFILE_SQL } from './common.sql.js';
import { DbService, one } from './db.js';
import { IS_PUBLIC, ROLES_KEY } from './decorators.js';
import { env } from './env.js';
import { verifyToken } from './jwt.js';
import type { AuthedRequest, Role } from './types.js';

/**
 * Runs on every route. Checks the login token (Authorization: Bearer ...), loads the user's
 * profile on each request so a disabled account stops working at once, and enforces @Roles(...).
 * The database enforces the same rules again through Row Level Security.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    const payload = token ? verifyToken(token, env.jwtSecret) : null;
    if (!payload) throw new UnauthorizedException('Sign in first');

    const profile = await this.db.asService((tx) =>
      one<{ id: string; full_name: string; role: Role; active: boolean }>(tx, PROFILE_SQL, [payload.sub]),
    );
    if (!profile) throw new UnauthorizedException('Sign in first');
    if (!profile.active) throw new ForbiddenException('Your account is disabled');

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(profile.role)) throw new ForbiddenException('Not allowed for your role');

    req.user = { id: profile.id, role: profile.role, fullName: profile.full_name };
    return true;
  }
}
