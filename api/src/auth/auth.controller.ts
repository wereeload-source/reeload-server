import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Body } from '@nestjs/common';
import { CurrentUser, Public } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../common/types.js';
import {
  ChangePassword, Login, RefreshInput, type ChangePasswordInput, type LoginInput,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 5 tries per 15 minutes from one address. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('auth/login')
  @HttpCode(200)
  login(@Body({ schema: Login }) body: LoginInput) {
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('auth/refresh')
  @HttpCode(200)
  refresh(@Body({ schema: RefreshInput }) body: { refresh_token: string }) {
    return this.auth.refresh(body.refresh_token);
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(200)
  logout(@Body({ schema: RefreshInput }) body: { refresh_token: string }) {
    return this.auth.logout(body.refresh_token);
  }

  @Get('me')
  @Can.Anyone()
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('auth/password')
  @Can.Anyone()
  @HttpCode(200)
  changePassword(@CurrentUser() user: AuthUser, @Body({ schema: ChangePassword }) body: ChangePasswordInput) {
    return this.auth.changePassword(user, body.current_password, body.new_password);
  }
}
