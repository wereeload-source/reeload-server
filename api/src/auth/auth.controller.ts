import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuthService } from './auth.service.js';
import { ChangePassword, Login, type ChangePasswordInput, type LoginInput } from './auth.schemas.js';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Email and password in, a token out. Send it as `Authorization: Bearer <token>`. */
  @Public()
  @Post('auth/login')
  @HttpCode(200)
  login(@Body(new ZodPipe(Login)) body: LoginInput) {
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Post('auth/password')
  @HttpCode(200)
  changePassword(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ChangePassword)) body: ChangePasswordInput) {
    return this.auth.changePassword(user.id, body.current, body.next);
  }
}
