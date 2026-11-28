import { Injectable } from '@nestjs/common';
import { AuthenticationStorage, type RefreshTokenRecord, type RefreshTokenStore } from '@nestjs/authentication';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Keeps refresh tokens in the database, so a restart or a second API instance does not sign everyone out.
 * A refresh token works once: marking it used is one conditional update, so two parallel refreshes cannot both win.
 */
@Injectable()
export class PrismaRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly prisma: PrismaService, storage: AuthenticationStorage) {
    storage.registerSource({ refreshTokens: this });
  }

  async getRefreshToken(id: string): Promise<RefreshTokenRecord | undefined> {
    const row = await this.prisma.refreshToken.findUnique({ where: { id } });
    if (!row) return undefined;
    const { revoked: _revoked, usedAt, claims, ...rest } = row;
    return { ...rest, ...(usedAt ? { usedAt } : {}), claims: claims as Record<string, unknown> } as RefreshTokenRecord;
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    const { id, familyId, userId, createdAt, expiresAt, familyExpiresAt, claims } = record;
    await this.prisma.refreshToken.create({
      data: { id, familyId, userId, createdAt, expiresAt, familyExpiresAt, claims: (claims ?? {}) as Prisma.InputJsonValue },
    });
    // Expired families are cleaned up as new tokens are written.
    await this.prisma.refreshToken.deleteMany({ where: { familyExpiresAt: { lte: createdAt } } });
  }

  async markRefreshTokenUsed(id: string, at: Date): Promise<boolean> {
    const done = await this.prisma.refreshToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: at } });
    return done.count === 1;
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { familyId }, data: { revoked: true } });
  }

  async isRefreshTokenFamilyRevoked(familyId: string): Promise<boolean> {
    return (await this.prisma.refreshToken.count({ where: { familyId, revoked: true } })) > 0;
  }

  async revokeUserRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: { revoked: true } });
  }
}
