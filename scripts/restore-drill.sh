#!/usr/bin/env bash
# Restore drill (build plan step 11): proves a backup can really be restored, before go-live and after
# any big change. Takes a backup of SOURCE_URL, restores it into an EMPTY database at TARGET_URL, then
# checks that the data and the security rules came back.
#   SOURCE_URL=... TARGET_URL=... scripts/restore-drill.sh
# On Neon: create a branch (or a second empty database) for TARGET_URL, run this, then delete it.
set -euo pipefail
: "${SOURCE_URL:?Set SOURCE_URL (the live database, direct connection)}"
: "${TARGET_URL:?Set TARGET_URL (an empty database to restore into)}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

DATABASE_URL="$SOURCE_URL" "$here/backup.sh" "$tmp/drill.dump"
TARGET_URL="$TARGET_URL" "$here/restore.sh" "$tmp/drill.dump"

q() { psql "$1" -qAt -v ON_ERROR_STOP=1 -c "$2"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok    $1 ($2)"; else echo "FAIL  $1: live $2, restored $3"; fail=1; fi; }

# 1. Every table has the same number of rows.
for t in $(q "$SOURCE_URL" "select table_schema||'.'||table_name from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','auth') and table_name <> 'schema_migrations' order by 1"); do
  check "rows in $t" "$(q "$SOURCE_URL" "select count(*) from $t")" "$(q "$TARGET_URL" "select count(*) from $t")"
done

# 2. A user can still sign in with their password (hashes came across).
login="select count(*) from auth.users u where u.encrypted_password = crypt('reelops123', u.encrypted_password) and lower(u.email)='kavya@reelops.local'"
live_login="$(q "$SOURCE_URL" "$login" 2>/dev/null || echo 0)"
if [ "$live_login" != "0" ]; then check "demo admin can sign in" "$live_login" "$(q "$TARGET_URL" "$login")"; fi

# 3. The security rules came back: Ops reads no money, and the audit log cannot be edited.
ops="$(q "$TARGET_URL" "select id from public.profiles where role='ops' and active limit 1" || true)"
if [ -n "$ops" ]; then
  n="$(psql "$TARGET_URL" -qAt -v ON_ERROR_STOP=1 <<SQL
begin; set local role authenticated; select set_config('request.jwt.claim.sub','$ops',true) \gset
select count(*) from public.payments;
rollback;
SQL
)"
  check "ops reads 0 payments after restore" "0" "$(echo "$n" | tail -1)"
fi
if psql "$TARGET_URL" -qAt -c "begin; set local role authenticated; update public.audit_log set action='x'; rollback;" >/dev/null 2>&1; then
  echo "FAIL  audit log can be edited after restore"; fail=1
else
  echo "ok    audit log is still read-only after restore"
fi

[ "$fail" = 0 ] && echo "Restore drill passed." || { echo "Restore drill FAILED." >&2; exit 1; }
