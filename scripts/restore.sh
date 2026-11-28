#!/usr/bin/env bash
# Restores a backup into an EMPTY database.
#   TARGET_URL=... scripts/restore.sh backup.dump
# Create the empty database (or a Neon branch) first, then point DATABASE_URL at it.
set -euo pipefail
: "${TARGET_URL:?Set TARGET_URL to the empty database to restore into}"
file="${1:?Usage: restore.sh backup.dump}"
[ -s "$file" ] || { echo "Backup file not found or empty: $file" >&2; exit 1; }
pg_restore --no-owner --exit-on-error --dbname "$TARGET_URL" "$file"
echo "Restored $file"
