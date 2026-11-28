import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { CheckinModule } from '../checkin/checkin.module.js';
import type { Env } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthCookies } from './cookies.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtStrategy } from './jwt.strategy.js';
import { PasswordResetService } from './password-reset.service.js';
import { Passwords } from './passwords.js';
import { SessionsService } from './sessions.service.js';
import { Tokens } from './tokens.js';

/** Cookie JWT sign-in. Global, so any module can hash passwords or end a person's sessions. */
@Global()
@Module({
  imports: [
    PassportModule,
    CheckinModule, // WhatsAppService sends the password-reset code
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('ACCESS_TOKEN_TTL', { infer: true }) as `${number}m` },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionsService, PasswordResetService, Passwords, Tokens, AuthCookies, JwtStrategy,
    // Registered here, not in AppModule: this module comes before AuthorizationModule, so request.user is set when permissions are checked.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [Passwords, SessionsService],
})
export class AuthModule {}
