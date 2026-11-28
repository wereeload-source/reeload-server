#!/usr/bin/env bash
# Apply migrations + seed + rule tests to a throwaway Postgres database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-reelops_test}
dropdb --if-exists "$DB" && createdb "$DB"
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1"; }
run db/neon/001_auth.sql
for f in supabase/migrations/*.sql; do echo "-- $f"; run "$f"; done
run supabase/seed.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/rules.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/foundation.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/acceptance.sql
echo "All database rule tests passed."
