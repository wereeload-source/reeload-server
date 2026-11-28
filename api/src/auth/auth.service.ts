import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '../common/types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type LoginInput, normalizeIdentifier } from './auth.schemas.js';
import { AUTH_USER_SELECT } from './jwt.strategy.js';
import { Passwords } from './passwords.js';
import { type DeviceInfo, type IssuedTokens, SessionsService } from './sessions.service.js';

const INVALID = 'Invalid credentials';

/** Phones are matched as typed and with spaces, dashes and brackets removed. */
export const phoneCandidates = (value: string) => [...new Set([value.trim(), normalizeIdentifier('phone', value)])];

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: Passwords,
    private readonly sessions: SessionsService,
  ) {}

  /** Finds an account by email or phone. */
  findByIdentifier(kind: 'email' | 'phone', identifier: string) {
    const select = { ...AUTH_USER_SELECT, passwordHash: true };
    return kind === 'email'
      ? this.prisma.user.findUnique({ where: { email: normalizeIdentifier('email', identifier) }, select })
      : this.prisma.user.findFirst({ where: { phone: { in: phoneCandidates(identifier) } }, select });
  }

  /**
   * Checks the password and starts a session. A missing account, a disabled account and a wrong
   * password all get the same 401 and take about the same time.
   */
  async login(body: LoginInput, device: DeviceInfo): Promise<{ user: AuthUser; tokens: IssuedTokens }> {
    const found = await this.findByIdentifier(body.loginType === 'EMAIL_PASSWORD' ? 'email' : 'phone', body.identifier);
    const valid = await this.passwords.verify(body.password, found?.passwordHash);
    if (!found || !valid || !found.active) throw new UnauthorizedException(INVALID);

    if (this.passwords.needsUpgrade(found.passwordHash)) {
      await this.prisma.user.update({ where: { id: found.id }, data: { passwordHash: await this.passwords.hash(body.password) } });
    }
    const { passwordHash: _hash, ...user } = found;
    return { user: user as AuthUser, tokens: await this.sessions.start(user, device) };
  }

  /** The signed-in user, read fresh from the database. */
  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: AUTH_USER_SELECT });
    if (!user?.active) throw new UnauthorizedException('Please sign in again');
    return user as AuthUser;
  }

  /** Changes the password and signs the account out on every device (this one too). */
  async changePassword(user: AuthUser, current: string, next: string): Promise<{ ok: true }> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!(await this.passwords.verify(current, row.passwordHash))) throw new BadRequestException('Your current password is wrong');
    const passwordHash = await this.passwords.hash(next);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);
    return { ok: true };
  }
}
