#!/usr/bin/env bash
# Apply database migrations to the database in $DATABASE_URL (Neon, or any Postgres).
# Safe to run again: each file is applied once and recorded in public.schema_migrations.
#
#   DATABASE_URL=postgres://... scripts/migrate.sh              # migrations only
#   DATABASE_URL=postgres://... scripts/migrate.sh --seed       # plus demo users and jobs (dev only)
#   SKIP_AUTH_STUB=1 ...                                        # on Supabase, which has its own auth schema
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?Set DATABASE_URL to the Neon connection string}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -c "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())"

files=()
[ -z "${SKIP_AUTH_STUB:-}" ] && files+=(db/neon/*.sql)
files+=(supabase/migrations/*.sql)

for f in "${files[@]}"; do
  name=$(basename "$(dirname "$f")")/$(basename "$f")
  done=$("${PSQL[@]}" -tA -c "select 1 from public.schema_migrations where name = '$name'")
  if [ -n "$done" ]; then echo "skip   $name"; continue; fi
  echo "apply  $name"
  "${PSQL[@]}" --single-transaction -f "$f"
  "${PSQL[@]}" -c "insert into public.schema_migrations (name) values ('$name')"
done

if [ "${1:-}" = "--seed" ]; then
  echo "seed   supabase/seed.sql (development data, password reelops123)"
  "${PSQL[@]}" -f supabase/seed.sql
fi
echo "Database is up to date."
