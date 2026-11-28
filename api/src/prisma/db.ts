import type { Prisma } from '../generated/prisma/client.js';

/** Either the shared client or a transaction's client: services take this so they work inside `$transaction`. */
export type Db = Prisma.TransactionClient;

/** Options for every multi-step write. Each one is all-or-nothing. */
export const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;
