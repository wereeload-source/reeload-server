import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy } from 'passport-jwt';
import type { AuthUser } from '../common/types.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCESS_COOKIE } from './cookies.js';
import { ACCESS_TYP, type AccessClaims } from './tokens.js';

export const AUTH_USER_SELECT = { id: true, email: true, fullName: true, phone: true, role: true, active: true } as const;

/** Reads the access token from its httpOnly cookie only. No Authorization header. */
const fromAccessCookie = (req: Request): string | null => {
  const value: unknown = req.cookies?.[ACCESS_COOKIE];
  return typeof value === 'string' && value ? value : null;
};

/**
 * Turns a valid access cookie into the signed-in user. The user and the session behind the token
 * are read from the database on every request, so disabling an account, signing out or resetting a
 * password takes effect at once rather than when the token expires.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    super({ jwtFromRequest: fromAccessCookie, ignoreExpiration: false, secretOrKey: config.get('JWT_SECRET', { infer: true }) });
  }

  async validate(claims: AccessClaims): Promise<AuthUser> {
    if (claims.typ !== ACCESS_TYP || !claims.sub || !claims.jti) throw new UnauthorizedException();
    const session = await this.prisma.session.findUnique({
      where: { accessTokenJti: claims.jti },
      select: { userId: true, expiresAt: true, user: { select: AUTH_USER_SELECT } },
    });
    if (!session || session.userId !== claims.sub || session.expiresAt < new Date() || !session.user.active) throw new UnauthorizedException();
    return session.user as AuthUser;
  }
}
