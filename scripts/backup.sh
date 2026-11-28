#!/usr/bin/env bash
# Backs up the whole database (tables and data) to one file.
#   DATABASE_URL=... scripts/backup.sh [output-file]
# Use the DIRECT (non-pooled) Neon connection string for pg_dump. Neon also keeps its own
# point-in-time history; this file is the copy you hold yourself. Store it somewhere other than Neon.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
out="${1:-reelops-$(date -u +%Y%m%d-%H%M%S).dump}"
pg_dump --format=custom --no-owner --file "$out" "$DATABASE_URL"
echo "Backup written to $out ($(du -h "$out" | cut -f1))"
