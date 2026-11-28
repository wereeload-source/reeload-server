import { applyDecorators, createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import type { AuthUser } from '../common/types.js';

export const IS_PUBLIC = 'reeload:public';

/**
 * The route needs no sign-in (login, refresh, logout, password reset, health, client download links).
 * It also satisfies the permissions guard, which refuses any route that declares no check.
 */
export const Public = () => applyDecorators(SetMetadata(IS_PUBLIC, true), Can.Anyone());

/** The signed-in user that the JWT strategy loaded from the database for this request. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
