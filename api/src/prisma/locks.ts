import type { Db } from './db.js';

/**
 * Takes a lock that lasts until the transaction ends, so two requests touching the same job or
 * reelmaker queue up instead of racing (e.g. two Ops users assigning the same reelmaker at once).
 * `$executeRaw` is used because the function returns void.
 */
export async function lock(tx: Db, key: string): Promise<void> {
  await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
