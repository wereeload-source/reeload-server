#!/usr/bin/env bash
# Restores a backup into an EMPTY database.
#   TARGET_URL=... scripts/restore.sh backup.dump
# Create the empty database (or a Neon branch) first. The roles anon / authenticated / service_role are
# created here if the server does not have them yet. Grants are part of the backup, so the column-level
# rules (for example the audit log being read-only) come back exactly as they were.
set -euo pipefail
: "${TARGET_URL:?Set TARGET_URL to the empty database to restore into}"
file="${1:?Usage: restore.sh backup.dump}"
[ -s "$file" ] || { echo "Backup file not found or empty: $file" >&2; exit 1; }
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -qAt <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
SQL
pg_restore --no-owner --exit-on-error --dbname "$TARGET_URL" "$file"
echo "Restored $file"
