import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PasswordHasher, TokenService } from '@nestjs/authentication';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../common/types.js';
import { AUTH_USER_SELECT } from './user-jwt.provider.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
  ) {}

  async login(email: string, password: string) {
    const found = await this.prisma.user.findUnique({ where: { email }, select: { ...AUTH_USER_SELECT, passwordHash: true } });
    // verify() also runs against a dummy hash when there is no account, so timing does not reveal which emails exist.
    const valid = await this.hasher.verify(password, found?.passwordHash);
    // The same message for a wrong password, an unknown email and a disabled account.
    if (!valid || !found || !found.active) throw new UnauthorizedException('Wrong email or password');

    if (this.hasher.needsRehash(found.passwordHash)) {
      await this.prisma.user.update({ where: { id: found.id }, data: { passwordHash: await this.hasher.hash(password) } });
    }
    const { passwordHash: _hash, ...user } = found;
    const issued = await this.tokens.issue(user.id, { method: 'password' });
    return { ...issued, user };
  }

  refresh(refreshToken: string) {
    return this.tokens.refresh(refreshToken);
  }

  /** Ends this device's sign-in: the refresh token stops working at once. */
  async logout(refreshToken: string): Promise<{ ok: true }> {
    await this.tokens.revoke(refreshToken);
    return { ok: true };
  }

  async changePassword(user: AuthUser, current: string, next: string): Promise<{ ok: true }> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!(await this.hasher.verify(current, row.passwordHash))) throw new BadRequestException('Your current password is wrong');
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.hasher.hash(next) } });
    // Signs the account out everywhere else.
    await this.tokens.revokeAll(user.id);
    return { ok: true };
  }
}
