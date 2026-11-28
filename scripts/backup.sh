#!/usr/bin/env bash
# Backs up the whole database (tables and data) to one file.
#   DATABASE_URL=... scripts/backup.sh [output-file]
# Use the Supabase session/direct connection string (DIRECT_URL, port 5432) for pg_dump, not the
# transaction pooler. This file is the copy you hold yourself: store it somewhere other than Supabase.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
out="${1:-reeload-$(date -u +%Y%m%d-%H%M%S).dump}"
pg_dump --format=custom --no-owner --file "$out" "$DATABASE_URL"
echo "Backup written to $out ($(du -h "$out" | cut -f1))"
