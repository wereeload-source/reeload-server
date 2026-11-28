import { randomInt } from 'node:crypto';
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppService } from '../checkin/whatsapp.service.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ForgotPasswordInput, ResetPasswordBody, ValidateResetQuery, VerifyResetOtpInput } from './auth.schemas.js';
import { AuthService } from './auth.service.js';
import { Passwords, sameHash, sha256 } from './passwords.js';
import { Tokens } from './tokens.js';

/** The same answer whether or not the account exists. */
export const FORGOT_MESSAGE = "If an account exists for that identifier, we've sent instructions to reset your password.";

/**
 * Password reset by WhatsApp code: forgot-password sends a 6-digit code, verify-otp swaps a correct
 * code for a 5-minute reset ticket, reset-password sets the new password and signs out every device.
 * Codes and link tokens are stored only as sha256 hashes and work once.
 */
@Injectable()
export class PasswordResetService {
  private readonly log = new Logger('PasswordReset');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly passwords: Passwords,
    private readonly tokens: Tokens,
    private readonly whatsapp: WhatsAppService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private minutes(key: 'PASSWORD_RESET_OTP_TTL_MINUTES' | 'PASSWORD_RESET_TOKEN_TTL_MINUTES'): Date {
    return new Date(Date.now() + this.config.get(key, { infer: true }) * 60_000);
  }

  private get maxAttempts(): number {
    return this.config.get('PASSWORD_RESET_MAX_OTP_ATTEMPTS', { infer: true });
  }

  async forgot(body: ForgotPasswordInput): Promise<{ message: string }> {
    const user = await this.auth.findByIdentifier('phone', body.identifier);
    if (user?.active && user.phone) {
      const otp = String(randomInt(100_000, 1_000_000));
      await this.prisma.verificationToken.create({
        data: { userId: user.id, tokenHash: sha256(otp), channel: 'WHATSAPP', purpose: 'PASSWORD_RESET', expiresAt: this.minutes('PASSWORD_RESET_OTP_TTL_MINUTES') },
      });
      // A failed send must not reveal that the account exists: the answer stays the same.
      await this.whatsapp.sendOtp(user.phone, otp).catch((e: unknown) => this.log.error(`Reset code not sent: ${(e as Error).message}`));
    }
    return { message: FORGOT_MESSAGE };
  }

  /** The newest unused, unexpired reset code for this phone's account. */
  private async latestCode(identifier: string) {
    const user = await this.auth.findByIdentifier('phone', identifier);
    if (!user?.active) return null;
    return this.prisma.verificationToken.findFirst({
      where: { userId: user.id, purpose: 'PASSWORD_RESET', channel: 'WHATSAPP', usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async verifyOtp(body: VerifyResetOtpInput): Promise<{ resetTicket: string }> {
    const row = await this.latestCode(body.identifier);
    if (!row) throw new BadRequestException('Invalid or expired code');
    if (row.attempts >= this.maxAttempts) throw new BadRequestException('Too many attempts, request a new code');
    if (!sameHash(sha256(body.otp), row.tokenHash)) {
      // Counted only while under the limit, so parallel guesses cannot push past it unnoticed.
      await this.prisma.verificationToken.updateMany({ where: { id: row.id, attempts: { lt: this.maxAttempts } }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Invalid or expired code');
    }
    return { resetTicket: await this.tokens.signResetTicket(row.userId, row.id) };
  }

  /** The verification row a link token or reset ticket points at, if it is still usable. */
  private async rowFor(input: { token?: string; resetTicket?: string }) {
    const now = new Date();
    if (input.token) {
      return this.prisma.verificationToken.findFirst({
        where: { tokenHash: sha256(input.token), purpose: 'PASSWORD_RESET', channel: 'EMAIL', usedAt: null, expiresAt: { gt: now } },
        include: { user: { select: { active: true } } },
      });
    }
    if (input.resetTicket) {
      const claims = await this.tokens.verifyResetTicket(input.resetTicket);
      if (!claims) return null;
      return this.prisma.verificationToken.findFirst({
        where: { id: claims.tokenId, userId: claims.sub, purpose: 'PASSWORD_RESET', usedAt: null, expiresAt: { gt: now } },
        include: { user: { select: { active: true } } },
      });
    }
    return null;
  }

  async validate(q: ValidateResetQuery): Promise<{ valid: boolean }> {
    const row = await this.rowFor(q);
    return { valid: !!row?.user.active };
  }

  async reset(body: ResetPasswordBody): Promise<{ message: string }> {
    const row = await this.rowFor(body);
    if (!row?.user.active) throw new UnauthorizedException(body.token ? 'Invalid or expired reset link' : 'Invalid or expired reset ticket');
    const passwordHash = await this.passwords.hash(body.newPassword);
    await this.prisma.$transaction(async (tx) => {
      // Single use: only the first request to mark the row used goes on.
      const { count } = await tx.verificationToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (count !== 1) throw new UnauthorizedException('Invalid or expired reset ticket');
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: row.userId } });
    });
    await this.notifyChanged(row.userId);
    return { message: 'Your password has been reset. Sign in with the new one.' };
  }

  /** "Your password was changed", after the reset is saved. A failure here never undoes the reset. */
  private async notifyChanged(userId: string): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: { userId, title: 'Your password was changed', body: 'If this was not you, tell an admin at once.' },
      });
    } catch (e) {
      this.log.error(`Password-changed notice not saved: ${(e as Error).message}`);
    }
  }
}
