import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lifetimeMs } from './cookies.js';
import { Passwords, sha256 } from './passwords.js';
import { Tokens } from './tokens.js';

/** At most this many signed-in devices per person; a new sign-in beyond it ends the oldest. */
export const MAX_SESSIONS = 5;

export interface DeviceInfo {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface IssuedTokens {
  access: string;
  refresh: string;
}

/**
 * bcrypt reads only the first 72 bytes of its input, and the first 72 bytes of every JWT on a session are the
 * same (header plus the start of the payload). Hashing the raw token would make a rotated-out refresh token still
 * match. So the token is reduced to its sha256 digest first (64 hex characters) and that digest is what bcrypt hashes.
 */
const refreshDigest = (token: string): string => sha256(token);

/** Sign-in sessions: one row per device, the refresh token kept only as a bcrypt hash. */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: Tokens,
    private readonly passwords: Passwords,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private expiry(): Date {
    return new Date(Date.now() + lifetimeMs(this.config.get('REFRESH_TOKEN_TTL', { infer: true })));
  }

  /** A new session for a password (or code) that has just been checked. */
  async start(user: { id: string; email: string }, device: DeviceInfo): Promise<IssuedTokens> {
    const jti = randomUUID();
    const sessionId = randomUUID();
    const access = await this.tokens.signAccess(user, jti);
    const refresh = await this.tokens.signRefresh(user.id, sessionId);
    const refreshTokenHash = await this.passwords.hash(refreshDigest(refresh));
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      const live = await tx.session.findMany({
        where: { userId: user.id, expiresAt: { gt: now } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (live.length >= MAX_SESSIONS) {
        await tx.session.deleteMany({ where: { id: { in: live.slice(0, live.length - MAX_SESSIONS + 1).map((s) => s.id) } } });
      }
      await tx.session.create({
        data: {
          id: sessionId,
          userId: user.id,
          refreshTokenHash,
          accessTokenJti: jti,
          ipAddress: device.ipAddress?.slice(0, 100) ?? null,
          userAgent: device.userAgent?.slice(0, 500) ?? null,
          expiresAt: this.expiry(),
        },
      });
    });
    return { access, refresh };
  }

  /**
   * Swaps a refresh token for a new pair on the same session. A refresh token works once: a token
   * that does not match the session (stolen, or already rotated) ends the session.
   */
  async rotate(rawRefresh: string): Promise<IssuedTokens> {
    const claims = await this.tokens.verifyRefresh(rawRefresh);
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sessionId },
      include: { user: { select: { id: true, email: true, active: true } } },
    });
    if (!session || session.userId !== claims.sub) throw new UnauthorizedException('Session not found');
    const end = async (message: string): Promise<never> => {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      throw new UnauthorizedException(message);
    };
    if (session.expiresAt < new Date()) return end('Session expired');
    if (!session.user.active) return end('Account is not active');
    if (!(await this.passwords.verify(refreshDigest(rawRefresh), session.refreshTokenHash))) return end('Invalid refresh token');
    if (!session.accessTokenJti) return end('Invalid refresh token');

    const jti = randomUUID();
    const access = await this.tokens.signAccess(session.user, jti);
    const refresh = await this.tokens.signRefresh(session.user.id, session.id);
    // Only the request still holding the hash it compared against may rotate: a second, simultaneous
    // use of the same refresh token finds nothing to update and is refused.
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash },
      data: { refreshTokenHash: await this.passwords.hash(refreshDigest(refresh)), accessTokenJti: jti, expiresAt: this.expiry(), lastRefreshAt: new Date() },
    });
    if (count !== 1) return end('Invalid refresh token');
    return { access, refresh };
  }

  /** Ends the session a refresh token belongs to. Invalid or already-ended sessions are ignored. */
  async endByRefreshToken(rawRefresh: string | undefined): Promise<void> {
    if (!rawRefresh) return;
    const claims = await this.tokens.verifyRefresh(rawRefresh).catch(() => null);
    if (claims) await this.prisma.session.deleteMany({ where: { id: claims.sessionId, userId: claims.sub } });
  }

  /** The session id inside a refresh token, or null. */
  async sessionIdOf(rawRefresh: string | undefined): Promise<string | null> {
    if (!rawRefresh) return null;
    return (await this.tokens.verifyRefresh(rawRefresh).catch(() => null))?.sessionId ?? null;
  }

  list(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastRefreshAt: true, expiresAt: true },
    });
  }

  async remove(userId: string, sessionId: string): Promise<{ ok: true }> {
    const { count } = await this.prisma.session.deleteMany({ where: { id: sessionId, userId } });
    if (!count) throw new NotFoundException('Session not found');
    return { ok: true };
  }

  /** Signs out every other device. */
  async removeOthers(userId: string, keepSessionId: string | null): Promise<{ removed: number }> {
    const { count } = await this.prisma.session.deleteMany({ where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) } });
    return { removed: count };
  }

  /** Signs out every device (password changed or reset, account disabled). */
  async removeAll(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }
}
