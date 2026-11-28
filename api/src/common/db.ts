import { Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { env } from './env.js';

export type Tx = pg.PoolClient;

/** Runs a query and returns the rows. */
export async function rows<T = Record<string, unknown>>(tx: Tx, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await tx.query(sql, params)).rows as T[];
}

/** First row, or null. */
export async function one<T = Record<string, unknown>>(tx: Tx, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(tx, sql, params))[0] ?? null;
}

/**
 * Postgres access. Every request runs inside a transaction as the signed-in user:
 *
 *   set local role authenticated;  select set_config('request.jwt.claim.sub', <user id>, true);
 *
 * so Row Level Security and the workflow functions (confirm_job, assign_job, ...) decide what that
 * user may read and change, exactly as they would on Supabase. The API checks roles first; the
 * database is the second, stricter line.
 *
 * `asService` is for the few things no user role may do (login, creating users, OTP codes, file
 * records). Check the caller's role before using it.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private pool?: pg.Pool;

  private get db(): pg.Pool {
    return (this.pool ??= new pg.Pool({ connectionString: env.databaseUrl, max: env.poolMax }));
  }

  async asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(fn, async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    });
  }

  /** Runs as the database owner. `actorId` is only recorded in the audit log. */
  async asService<T>(fn: (tx: Tx) => Promise<T>, actorId?: string): Promise<T> {
    return this.run(fn, async (tx) => {
      if (actorId) await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [actorId]);
    });
  }

  private async run<T>(fn: (tx: Tx) => Promise<T>, setup: (tx: Tx) => Promise<void>): Promise<T> {
    const tx = await this.db.connect();
    try {
      await tx.query('begin');
      await setup(tx);
      const result = await fn(tx);
      await tx.query('commit');
      return result;
    } catch (e) {
      await tx.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      tx.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
