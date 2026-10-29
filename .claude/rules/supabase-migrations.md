---
paths:
  - "supabase/migrations/**"
  - "supabase/tests/**"
  - "scripts/lib/schema_assert.py"
  - "scripts/lib/migration_drift.py"
---

# Writing a Supabase migration

The commands (`db-push`, `db-check`, local replay) and who applies a
migration are in `supabase/CLAUDE.md` under "Migrations".

- Read the dry run before pushing. A migration dated earlier than the last
  applied one is refused by a plain `db push` and needs `--include-all`, which
  applies every pending migration.
- Never edit or renumber an applied migration; add a new one. Check for a
  timestamp collision first: `ls supabase/migrations | sed 's/_.*//' | uniq -d`.
- Drift has three row shapes in `supabase migration list`: in sync, local-only
  (pending), and remote-only (the database ran something this branch has no
  file for). `scripts/lib/migration_drift.py` reports all three (exit 0 / 2 /
  1); tests in `tests/test_migration_drift.py`.
- The ledger agreeing is not the schema agreeing. `migration list` reads a table
  of version strings. `20260209000000_pending_nullable_content.sql` was stamped
  applied while its `DROP NOT NULL` never ran, which broke every metadata save
  (23502) months later. `supabase db dump --schema public` shows the real schema;
  `db-check` (`scripts/lib/schema_assert.py`, list in `INVARIANTS`) asserts the
  load-bearing parts. An invariant belongs there only when a named consumer
  breaks without it and no other guard catches it (the rule is at the top of that
  file). Add new ones there with a `why`.
- A new migration that changes nullability, adds or drops a constraint, or drops
  an object must end with a `DO $$ ... RAISE EXCEPTION` block asserting its own
  postcondition (query `pg_attribute`, `pg_constraint`, `pg_proc`,
  `to_regclass`, `pg_policies`). `db push` runs each file in a transaction, so a
  failed assertion rolls it back and the ledger can't be stamped without the DDL
  running. Assert the postcondition, not the statement you just typed; keep it in
  the same file. Don't retrofit applied migrations. Example:
  `supabase/migrations/20260819000000_pending_content_really_nullable.sql`.
- Before narrowing a read policy, backfill the rows the new predicate would hide
  (the `20260930000000` migration backfills lists with `owners = '{}'`, which the
  client's sync would otherwise treat as deleted).
- `SET search_path = ''` on a function whose body names tables unqualified breaks
  it: `20260107010000` did that to `log_events` and every call failed with 42P01
  for eight months, unnoticed because `supabase.rpc` resolves `{ error }`
  instead of throwing. Qualify every table (`public.analytics_events`) and call
  the function in the migration's own postcondition.
- Local replay needs `supabase/tests/baseline/` because a few objects
  (`user_lists`, `user_list_items`, `song_flags`, `submit_flag`,
  `get_visitor_flag_count`) were made in the dashboard and have no `CREATE` in
  `migrations/`. `post_deploy_check.sql` and `post_deploy_probe.sql` are the
  read-only checks to run against production after `db-push`; the probe's pass
  signal is its last line, `PASS: post_deploy_probe.sql`, with no ERROR line.
  See `supabase/tests/README.md`.
- A new `SECURITY DEFINER` function in `public` is executable by PUBLIC and, by
  Supabase default privileges, `anon` and `authenticated`. In the same
  migration, `REVOKE ALL ... FROM PUBLIC, anon` and grant only what is needed.
