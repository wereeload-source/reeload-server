import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthUser } from '../common/types.js';
import {
  ChangePassword, type ChangePasswordInput, ForgotPassword, type ForgotPasswordInput, Login, type LoginInput, ResetPasswordInput,
  type ResetPasswordBody, SessionId, ValidateReset, type ValidateResetQuery, VerifyResetOtp, type VerifyResetOtpInput,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';
import { AuthCookies, REFRESH_COOKIE } from './cookies.js';
import { CurrentUser, Public } from './decorators.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionsService } from './sessions.service.js';

const refreshCookie = (req: Request): string | undefined => {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value ? value : undefined;
};

const device = (req: Request) => ({ ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

/** The profile fields a browser may see. */
const profile = (u: AuthUser) => ({ id: u.id, email: u.email, displayName: u.fullName, fullName: u.fullName, phone: u.phone, role: u.role, active: u.active });

/**
 * Cookie sign-in. Tokens travel only in httpOnly cookies (access_token, refresh_token) and never in
 * a response body. Login, refresh, logout and the password-reset routes are public.
 */
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly reset: PasswordResetService,
    private readonly cookies: AuthCookies,
  ) {}

  /** 5 tries per 15 minutes per account and address, 30 per address (common/throttle.ts). */
  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(@Body({ schema: Login }) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.login(body, device(req));
    this.cookies.set(res, tokens);
    return { message: 'Login successful', user: profile(user) };
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = refreshCookie(req);
    if (!raw) throw new UnauthorizedException('Refresh token not found');
    try {
      this.cookies.set(res, await this.sessions.rotate(raw));
    } catch (e) {
      this.cookies.clear(res);
      throw e;
    }
    return { message: 'Token refreshed successfully' };
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.endByRefreshToken(refreshCookie(req));
    this.cookies.clear(res);
    return { message: 'Logout successful' };
  }

  @Get('auth/me')
  @Can.Anyone()
  async me(@CurrentUser() user: AuthUser) {
    return profile(await this.auth.me(user.id));
  }

  /** Same as /auth/me, kept for older callers. */
  @Get('me')
  @Can.Anyone()
  async meAlias(@CurrentUser() user: AuthUser) {
    return profile(await this.auth.me(user.id));
  }

  @Get('auth/sessions')
  @Can.Anyone()
  listSessions(@CurrentUser() user: AuthUser) {
    return this.sessions.list(user.id);
  }

  @Delete('auth/sessions/:id')
  @Can.Anyone()
  removeSession(@CurrentUser() user: AuthUser, @Param('id', { schema: SessionId }) id: string) {
    return this.sessions.remove(user.id, id);
  }

  /** Signs out every device except this one. */
  @Delete('auth/sessions')
  @Can.Anyone()
  async removeOtherSessions(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.sessions.removeOthers(user.id, await this.sessions.sessionIdOf(refreshCookie(req)));
  }

  /** Changes the password and signs out every device, this one included. */
  @Post('auth/password')
  @Can.Anyone()
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body({ schema: ChangePassword }) body: ChangePasswordInput, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.changePassword(user, body.current_password, body.new_password);
    this.cookies.clear(res);
    return result;
  }

  /** 3 requests per hour per address and phone (PASSWORD_RESET_RATE_LIMIT_PER_HOUR). Same answer whether the account exists. */
  @Public()
  @Post('auth/forgot-password')
  @HttpCode(200)
  forgot(@Body({ schema: ForgotPassword }) body: ForgotPasswordInput) {
    return this.reset.forgot(body);
  }

  @Public()
  @Post('auth/reset-password/verify-otp')
  @HttpCode(200)
  verifyOtp(@Body({ schema: VerifyResetOtp }) body: VerifyResetOtpInput) {
    return this.reset.verifyOtp(body);
  }

  @Public()
  @Get('auth/reset-password/validate')
  validateReset(@Query({ schema: ValidateReset }) q: ValidateResetQuery) {
    return this.reset.validate(q);
  }

  @Public()
  @Post('auth/reset-password')
  @HttpCode(200)
  resetPassword(@Body({ schema: ResetPasswordInput }) body: ResetPasswordBody) {
    return this.reset.reset(body);
  }
}
