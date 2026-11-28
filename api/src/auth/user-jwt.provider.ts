import { Injectable } from '@nestjs/common';
import { AuthenticationRegistry, JwtBearerProvider, type JwtClaims } from '@nestjs/authentication';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../common/types.js';

export const AUTH_USER_SELECT = { id: true, email: true, fullName: true, phone: true, role: true, active: true } as const;

/**
 * Turns a valid access token into the signed-in user. The user is read from the database on every
 * request, so disabling an account (or changing its role) takes effect at once.
 */
@Injectable()
export class UserJwtProvider extends JwtBearerProvider<AuthUser> {
  constructor(private readonly prisma: PrismaService, registry: AuthenticationRegistry) {
    super({ realm: 'reeload' });
    registry.registerProvider(this, { order: 1 });
  }

  async validate({ sub }: JwtClaims): Promise<AuthUser | null> {
    if (!sub) return null;
    const user = await this.prisma.user.findUnique({ where: { id: sub }, select: AUTH_USER_SELECT });
    return user?.active ? user : null;
  }
}
