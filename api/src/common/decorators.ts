import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { AuthedRequest, Role } from './types.js';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';

/** Skips sign-in. Used for the health check and the client download page. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Only these roles may call the route. Without it, any signed-in user may. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** The signed-in user (see AuthGuard). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});
