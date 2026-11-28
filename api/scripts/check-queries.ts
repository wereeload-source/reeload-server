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
  '../src/jobs/jobs.sql.js',
  '../src/sales/sales.sql.js',
  '../src/assign/assign.sql.js',
  '../src/notifications/notifications.sql.js',
  '../src/shoots/shoots.sql.js',
  '../src/checkin/checkin.sql.js',
  '../src/uploads/uploads.sql.js',
  '../src/review/review.sql.js',
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
    // A module that builds SQL exports `checkQueries`: sample output with every optional part on.
    else if (name === 'checkQueries' && typeof value === 'object' && value) {
      for (const [k, v] of Object.entries(value as Record<string, string>)) queries.push([`${path.split('/').pop()}:${k}`, v]);
    }
  }
}

// `select (fn(...)).*` runs the function once per column (a job created ten times). Use `select * from fn(...)`.
const unsafe = queries.filter(([, sql]) => /\)\)\s*\.\*/.test(sql));
for (const [name] of unsafe) console.error(`BAD   ${name}: use "select * from fn(...)", not "select (fn(...)).*"`);

let failed = unsafe.length;
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
