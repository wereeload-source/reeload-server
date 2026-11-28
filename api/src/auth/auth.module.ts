import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PrismaRefreshTokenStore } from './refresh-token.store.js';
import { UserJwtProvider } from './user-jwt.provider.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, UserJwtProvider, PrismaRefreshTokenStore],
  exports: [AuthService],
})
export class AuthModule {}
