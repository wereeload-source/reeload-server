/**
 * A real Postgres for local development and e2e tests, without Docker or a Supabase account.
 *
 *   pnpm db:local          # starts Postgres on 127.0.0.1:54329 (data in api/.local-db, git-ignored)
 *
 * Then point DATABASE_URL at postgresql://reeload:reeload@127.0.0.1:54329/reeload and run
 * `pnpm db:migrate && pnpm db:seed`. Stop it with Ctrl+C. Never use this for production data.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const port = Number(process.env.LOCAL_DB_PORT ?? 54329);
const dir = join(import.meta.dirname, '..', '.local-db');
const fresh = !existsSync(join(dir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'reeload',
  password: 'reeload',
  port,
  persistent: true,
  onLog: () => {},
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('reeload');

console.log(`Local Postgres ready: postgresql://reeload:reeload@127.0.0.1:${port}/reeload`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
