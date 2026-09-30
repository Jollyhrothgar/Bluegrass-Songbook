#!/usr/bin/env bash
# Replay supabase/migrations/ in a throwaway LOCAL Supabase stack and run the
# SQL assertions in supabase/tests/*.test.sql against it.
#
#   supabase/tests/run.sh            # start stack, run tests, stop stack
#   supabase/tests/run.sh --keep     # leave the stack running afterwards
#
# Needs Docker and the Supabase CLI. Touches ONLY the local stack: it never
# reads supabase/.temp, never links, never pushes. Do not add `--linked`,
# `db push` or a remote --db-url here.
set -euo pipefail

KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPA="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/bb-migration-test.XXXXXX")"
mkdir -p "$WORK/supabase/migrations"

# Own project_id (container names) and shifted ports (543xx -> 544xx), so this
# never collides with a developer's normal `supabase start`.
sed -e 's/^project_id = .*/project_id = "bb-migration-test"/' \
    -e '/^port = 543[0-9][0-9]/ s/543/544/' \
    -e '/^shadow_port = 543[0-9][0-9]/ s/543/544/' \
    "$SUPA/config.toml" > "$WORK/supabase/config.toml"

cp "$HERE"/baseline/*.sql "$WORK/supabase/migrations/"
for f in "$SUPA"/migrations/*.sql; do
  ln -s "$f" "$WORK/supabase/migrations/$(basename "$f")"
done

stop_stack() {
  if [[ $KEEP -eq 0 ]]; then
    supabase stop --workdir "$WORK" --no-backup >/dev/null 2>&1 || true
    rm -rf "$WORK"
  else
    echo "Stack left running. Workdir: $WORK"
    echo "Stop with: supabase stop --workdir $WORK --no-backup"
  fi
}
trap stop_stack EXIT

# A leftover stack from an earlier --keep run shares the project_id and would
# be reused as-is (with its old migrations); always start from nothing.
supabase stop --workdir "$WORK" --no-backup >/dev/null 2>&1 || true

# Only what the tests need: postgres, PostgREST, auth (auth.users / auth.uid()).
supabase start --workdir "$WORK" \
  -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,mailpit,realtime,storage-api

DB_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
fail=0
for t in "$HERE"/*.test.sql; do
  echo "== $(basename "$t")"
  if ! psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$t"; then
    fail=1
  fi
done
# The same file the owner runs against production: it must be clean here, and
# it must be a pure SELECT (it is fed through psql with no transaction).
echo "== post_deploy_check.sql"
out="$(psql "$DB_URL" -X -At -F ' | ' -v ON_ERROR_STOP=1 -f "$HERE/post_deploy_check.sql")"
echo "$out" | grep -c '^PASS' | sed 's/^/   PASS rows: /'
if echo "$out" | grep '^FAIL'; then fail=1; fi
echo "== post_deploy_probe.sql"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$HERE/post_deploy_probe.sql" || fail=1

# db-check's invariants, against the local schema instead of the live one.
echo "== schema_assert (db-check invariants) against the local dump"
DUMP="$WORK/local_public_schema.sql"
supabase db dump --local --workdir "$WORK" --schema public -f "$DUMP" >/dev/null
python3 "$HERE/../../scripts/lib/schema_assert.py" --dump-file "$DUMP" | tail -3 || fail=1

echo "== rest_smoke.py"
python3 "$HERE/rest_smoke.py" || fail=1
exit $fail
