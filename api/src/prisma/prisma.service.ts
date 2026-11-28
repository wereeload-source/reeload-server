import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

/**
 * Connection settings for node-postgres. With DATABASE_CA_CERT set (Supabase: Project Settings > Database >
 * SSL certificate), the server certificate is verified against it. The sslmode in the URL is dropped then,
 * because node-postgres lets URL parameters override the ssl option.
 */
export function pgOptions(url: string, caCert?: string): { connectionString: string; ssl?: { ca: string; rejectUnauthorized: true } } {
  if (!caCert) return { connectionString: url };
  const u = new URL(url);
  for (const p of ['sslmode', 'sslrootcert', 'uselibpqcompat']) u.searchParams.delete(p);
  return { connectionString: u.toString(), ssl: { ca: caCert.replace(/\\n/g, '\n'), rejectUnauthorized: true } };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        ...pgOptions(config.getOrThrow('DATABASE_URL'), config.get('DATABASE_CA_CERT', { infer: true })),
        max: config.getOrThrow('DB_POOL_MAX'),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
