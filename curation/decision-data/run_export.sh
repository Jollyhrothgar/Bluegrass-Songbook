#!/bin/bash
set -uo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
LOG="$BASE/export_log.txt"
OUT="$BASE/bg_coverage.csv.gz"
SQL="$BASE/bg_query.sql"
{
  echo "START $(date)"
  echo "== docker container =="
  docker ps --filter name=musicbrainz-db --format '{{.Names}} | {{.Status}} | {{.Ports}}'
  echo "== running export (this can take 1-3 min) =="
  docker exec -i musicbrainz-db psql -U musicbrainz -d musicbrainz_db -v ON_ERROR_STOP=1 < "$SQL" | gzip > "$OUT"
  echo "pipe status: ${PIPESTATUS[*]}"
  echo "== output file =="
  ls -la "$OUT"
  echo "== rows incl header =="
  gzcat "$OUT" | wc -l
  echo "DONE $(date)"
} > "$LOG" 2>&1
echo "wrote $LOG"
