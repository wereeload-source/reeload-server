/**
 * Checks every SQL string the API uses against a real, migrated database.
 *
 *   DATABASE_URL=postgres://... npm run check:sql
 *
 * Each query is PREPAREd, so Postgres verifies the tables, columns, functions and parameter types
 * without running anything. It catches typos and schema drift that TypeScript cannot see.
 * Needs `psql`. Add a new `*.sql.ts` module to MODULES below when you create one.
 */
import { spawnSync } from 'node:child_process';

const MODULES = [
  '../src/common/common.sql.js',
  '../src/auth/auth.sql.js',
  '../src/users/users.sql.js',
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to a migrated database.');
  process.exit(2);
}

const queries: [string, string][] = [];
for (const path of MODULES) {
  const mod = (await import(path)) as Record<string, unknown>;
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === 'string' && /\s/.test(value)) queries.push([`${path.split('/').pop()}:${name}`, value]);
    // Builders that assemble SQL are checked with every optional part switched on.
    else if (typeof value === 'function' && name === 'updateProfileSql') {
      queries.push([`${path.split('/').pop()}:${name}`, (value as (c: string[]) => string)(['full_name', 'phone', 'active', 'role'])]);
    } else if (typeof value === 'function' && name.endsWith('Sql') && value.length === 0) {
      queries.push([`${path.split('/').pop()}:${name}`, (value as () => string)()]);
    }
  }
}

let failed = 0;
for (const [name, sql] of queries) {
  const r = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-c', `prepare q as ${sql.trim().replace(/;\s*$/, '')}`], { encoding: 'utf8' });
  if (r.status === 0) console.log(`ok    ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}\n      ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}`);
  }
}
console.log(`\n${queries.length - failed} of ${queries.length} queries valid`);
process.exit(failed ? 1 : 0);
