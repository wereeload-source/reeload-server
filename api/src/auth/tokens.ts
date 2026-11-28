import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.js';

/** Marks Reeload access tokens, so a token another app signed with the same secret is refused. */
export const ACCESS_TYP = 'reeload';

export interface AccessClaims {
  sub: string;
  email: string;
  jti: string;
  typ: typeof ACCESS_TYP;
}

export interface RefreshClaims {
  sub: string;
  sessionId: string;
  type: 'refresh';
  /** Makes every refresh token unique, even two signed in the same second, so a replayed one never matches. */
  jti: string;
}

export interface ResetTicketClaims {
  sub: string;
  tokenId: string;
  purpose: 'password_reset';
}

/**
 * Signs and checks the three kinds of JWT. Access tokens and reset tickets use JWT_SECRET (the
 * JwtModule default); refresh tokens pass JWT_REFRESH_SECRET on every call so they never use it.
 */
@Injectable()
export class Tokens {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get refreshSecret() {
    return this.config.get('JWT_REFRESH_SECRET', { infer: true });
  }

  signAccess(user: { id: string; email: string }, jti: string): Promise<string> {
    const claims: Omit<AccessClaims, 'sub'> = { email: user.email, jti, typ: ACCESS_TYP };
    return this.jwt.signAsync(claims, { subject: user.id });
  }

  signRefresh(userId: string, sessionId: string): Promise<string> {
    const claims: Omit<RefreshClaims, 'sub'> = { sessionId, type: 'refresh', jti: randomUUID() };
    return this.jwt.signAsync(claims, {
      subject: userId,
      secret: this.refreshSecret,
      expiresIn: this.config.get('REFRESH_TOKEN_TTL', { infer: true }) as `${number}d`,
    });
  }

  /** Throws 401 "Invalid refresh token" for anything but a valid, unexpired refresh token. */
  async verifyRefresh(token: string): Promise<RefreshClaims> {
    try {
      const claims = await this.jwt.verifyAsync<RefreshClaims>(token, { secret: this.refreshSecret });
      if (claims.type !== 'refresh' || !claims.sub || !claims.sessionId) throw new Error('not a refresh token');
      return claims;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  signResetTicket(userId: string, tokenId: string): Promise<string> {
    const claims: Omit<ResetTicketClaims, 'sub'> = { tokenId, purpose: 'password_reset' };
    return this.jwt.signAsync(claims, { subject: userId, expiresIn: '5m' });
  }

  /** The ticket's claims, or null when it is not a valid, unexpired reset ticket. */
  async verifyResetTicket(ticket: string): Promise<ResetTicketClaims | null> {
    try {
      const claims = await this.jwt.verifyAsync<ResetTicketClaims>(ticket);
      return claims.purpose === 'password_reset' && claims.sub && claims.tokenId ? claims : null;
    } catch {
      return null;
    }
  }
}
