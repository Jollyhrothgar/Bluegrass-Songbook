# Supabase Backend

Postgres (RLS), Google OAuth and Deno edge functions. Schema truth is
`supabase/migrations/`; function behaviour is in `supabase/functions/`. This
file records only what those don't show. Frontend client: `docs/js/supabase-auth.js`
(a regular script, not an ES module; everything hangs off `window.SupabaseAuth`).

Do not run `supabase db push` or live queries from an agent session. Pushing to
production is Mike's step (see "Migrations").

## Edge functions

Functions live in `supabase/functions/<name>/index.ts`; `ls supabase/functions`
lists them. Shared code is in `functions/_shared/`:

- `identity.ts`: verified identity (`requireUser` / `optionalUser` /
  `attributionFor`). The client never says who it is.
- `pending-dispatch.ts`: the change gate. It enforces a per-user rate limit
  counted from `submission_log`, `classifyChange` (below), and
  `dispatchPendingCommit`, which fires the `pending-commit` repository_dispatch.
- `commit-song.ts`: the `PendingSong` shape, the one Contents-API read used
  by classification, `holdReason`, `unretryableReason`, `isPlaceholderRow`.

No edge function writes `work.yaml`. `.github/workflows/process-pending.yml`
runs `scripts/lib/process_pending.py`, which writes through
`scripts/lib/works_writer.py`, the repo's one writer. Check this still holds:
`grep -rn "method: 'PUT'" supabase/functions` must find nothing. A function
that hand-writes `work.yaml` once overwrote real works with an empty stub, so
don't reintroduce one.

- `auto-commit-song`, `create-song-request` and `reconcile-pending` all import
  `pending-dispatch.ts`, so a retry classifies the way the first attempt did.
  Supabase bundles relative imports at deploy time: redeploy all three when
  anything in `_shared/` changes. (`deploy-functions.yml` deploys every
  function on a push to main that touches `supabase/functions/**`.)
- `reconcile-pending` requires the service role key itself (the anon key is
  public). It handles at most 25 rows per run, skips rows younger than 15
  minutes, and always returns HTTP 200 with `drift` and `stuckCount`. The
  workflow fails and opens or updates one "Reconciler: pending songs stuck
  uncommitted" issue when `stuckCount > 0`. `POST {"dryRun": true}` measures
  drift without dispatching.
- `github_committed` is flipped by the workflow after its push lands, never by
  a function. A function that set it early let `cleanup-pending` delete songs
  that had not reached git.
- `holdReason` and `unretryableReason` are siblings; do not merge them.
  `unretryableReason` judges a row's own shape (something it will never grow),
  which the edge runtime can see. `holdReason` reports a verdict reached in the
  repo (`process_pending.py:hold_reason` refusing a suppressed or merged-away
  work, or the lyric-similarity check `dedup_scorer` in `scripts/lib/dedup_scorer.py`, which
  `process_pending.py` runs before minting a new slug), handed back through the `dedup_hold` column.
  The reconciler skips both. `unretryableReason` is part-type aware: a metadata
  row has no content by design.
- `dedup_hold` keeps its old name because the reconciler, the RLS policies and
  the Dungeon's Release hold / Reject actions all key on it.

Secrets: `GITHUB_PAT` (repo scope), plus `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` supplied by the platform. The repo name is
hard-coded in the functions. Set secrets under Supabase dashboard > Edge
Functions > Secrets. Deploying by hand: `supabase functions deploy <name>`;
CI needs the `SUPABASE_ACCESS_TOKEN` repo secret.

## Contribution pipeline

Every signed-in user's save takes the same path; trust decides edit rights, not
speed:

1. The editor upserts a `pending_songs` row (`github_committed: false`). RLS
   lets any authenticated user insert rows they own; updating an existing row is
   owner-or-trusted.
2. The song shows in search at once. The boot overlay (`refreshPendingSongs()` in `docs/js/main.js`) selects only
   `PENDING_OVERLAY_COLUMNS` from `docs/js/corpus.js` (no `content`); the body is read per row when
   the song is opened.
3. `auto-commit-song` checks row ownership, applies the rate limit, classifies,
   and fires the `pending-commit` dispatch.
4. `process-pending.yml` writes `works/` via `works_writer`, pushes, then flips
   `github_committed`.

A `pending_songs` row has a kind, `part_type`:

- `lead-sheet`: `content` is ChordPro (cap 200KB). The row `id` IS the work slug.
- `tablature`: `content` is a serialized OTF (cap 2MB, since multi-track tabs
  are that big); `instrument` is required; `part_file` names the file a
  correction targets. The `id` is `tab:<slug>:<rand>` and `replaces_id` names
  the work.
- `metadata`: no content (a CHECK enforces it); `replaces_id` is mandatory. The
  `id` is `meta:<slug>:<rand>`. It edits only the work's title / artist / key /
  notes through `works_writer.update_metadata`.
- A song request is a lead-sheet row with `status = 'placeholder'` and no
  content, not a fourth `part_type`. `commit-song.ts:isPlaceholderRow` mirrors
  `process_pending.is_placeholder_row`. Both halves matter: `status` is sticky
  (the editor's save upserts onto the same row id and PostgREST only overwrites
  columns in the payload), so content settles it. Once there is a chart it is a
  chart row.

Tab and metadata ids live in their own namespaces because keying them by work id
collided on the primary key when two people tabbed the same song, and surfaced
as a permissions error (the update policy checks `created_by`).

### `classifyChange` outcomes

| Kind | Situation | Result |
|---|---|---|
| lead sheet | no work at the id | `create` |
| lead sheet | caller is in a lead-sheet part's `provenance.submitted_by`, or in `trusted_users` | `update` in place |
| lead sheet | anything else | `fork`: a new arrangement part, original untouched |
| tablature | no work at the id | `create` (slug from the title; the row id is synthetic) |
| tablature | `part_file` names a tab part the caller authored, or caller is trusted | `update` in place |
| tablature | anything else | `add`: a new sibling part |
| metadata | caller is trusted, or appears on any part of the work | `metadata` |
| metadata | no claim / no work at `replaces_id` / no `replaces_id` | refused: 403 / 404 / 400 (`MetadataRefusedError`), never a fork or create |
| placeholder | no work at the slug | `placeholder` (mint it) |
| placeholder | work exists / bad id / also sets `replaces_id` | refused: 409 / 400 / 400 (`PlaceholderRefusedError`), never an overwrite or a suffix |

Rules behind the table:

- Ownership is asked per part type: `submittersOf(yaml, 'lead-sheet')` for a
  chart, `tabPartOwners(yaml, file)` for a tab, mirrored in Python by
  `process_pending.owns_content(..., part_type)`. Owning a tab must not buy an
  in-place rewrite of someone's chart. The expectations live in one table,
  `functions/_shared/testdata/ownership-cases.json`, read by both
  `deno task test` and `uv run pytest tests/test_ownership_parity.py`. Add a row
  there when you change either side.
- `anyPartOwners(yaml)` is deliberately looser, and only the `metadata` branch of
  `classifyChange` (not a database column) calls it. Do not "fix" it into `submittersOf`. Contributing anything earns the
  right to say who wrote a song; it does not earn a rewrite of lyrics.
- Metadata refuses when the work is missing; a placeholder refuses when the
  work is present. A placeholder gets no trust bonus (trust used to turn on the
  overwrite). If `apply_placeholder_row` finds the work present at write time,
  the row is parked with `dedup_hold` for the Dungeon.
- `DispatchRefusedError` is the base of the typed refusals; callers catch it.
- The metadata action is logged as `metadata_edit`, which `get_leaderboard()`
  does not score but the rate limit does count.

Adding a trusted user (run in the SQL editor with the service role):
`INSERT INTO trusted_users (user_id, created_by) VALUES ('<uuid>', 'admin-manual');`
Admins are rows in `admin_users` (`user_id`). Users request trusted status through
`create-superuser-request`, which opens a GitHub issue. Admin approval is a
manual insert, then closing the issue.

Admins keep an instant delete on the song page (soft delete into
`deleted_songs`; `./scripts/utility sync-deleted-songs` pulls it into
`docs/data/deleted_songs.json`, which the build reads).

## Review queue

`review_requests` holds the destructive asks: `delete`, `suppress`,
`merge-redirect`. Trusted users file requests (insert needs `is_trusted_user()`
and `requested_by = auth.uid()`) and can read the queue. Only `is_admin()` may
change `status`; a trigger stamps `reviewed_by` / `reviewed_at` and freezes the
request's other fields. Nobody can delete rows. UI: `docs/js/review-queue.js` in
the Bluegrass Dungeon, whose third section lists parked `pending_songs`
(`dedup_hold` not null) with admin Release hold / Reject. That is why
`20260815150000_review_requests.sql` also adds `is_admin()` update/delete
policies on `pending_songs`.

Approving a `delete` runs the `delete_song` RPC. Approving `suppress` or
`merge-redirect` only records the decision, because they edit repo files and CI
does not do that from a table. The panel prints the local command:
`./scripts/utility curate suppress <work-id> --reason "..."`, or
`uv run python scripts/lib/merge_works.py <plan.json> --execute`.

## RLS notes

- Lists (`user_lists`, `user_list_items`, `list_followers`) are readable by
  owners and followers only, to signed-in users only. Anon never reads them; a
  share link goes through `get_public_list(list_id)` (SECURITY DEFINER). The
  read policies call the `is_list_follower` / `is_list_owner` definer helpers
  so the tables' policies don't recurse into each other.
- Ownership changes only through RPCs: `claim_list_invite`,
  `claim_orphaned_list`, `generate_list_invite`, `remove_list_owner(list_id)`
  (removes the caller only). `add_list_owner` is executable by nobody; only
  `claim_list_invite` calls it as the definer.
- A new `SECURITY DEFINER` function in `public` is executable by PUBLIC and, by
  Supabase default privileges, `anon` and `authenticated`. In the same
  migration, `REVOKE ALL ... FROM PUBLIC, anon` and grant only what is needed.
- Votes are unique on `(user_id, song_id, arr_key)`. `arr_key` is a generated
  `coalesce(arr_slug, '')`, because a nullable column can't carry the unique
  constraint and PostgREST can't arbitrate an upsert on an expression index.
  `arr_slug` null means the work's own chart.
- `leaderboard_salt` and `leaderboard_identities`: RLS on, zero policies. Only
  `get_leaderboard()` (security definer, granted to anon and authenticated)
  reads them. Never expose the salt: contributor uuids are public in
  `works/*/work.yaml` (`provenance.submitted_by`), so an unsalted alias hash
  would link aliases back to real people. The function returns no email or uuid
  for anyone but the caller. Frontend: `docs/js/high-scores.js`.
- Nothing can client-INSERT into `submission_log`.
- `doc_staging` and its storage bucket were dropped (the bucket may still need a
  manual delete in the dashboard).

## Migrations

`supabase/.temp/` is gitignored CLI state; `scripts/bootstrap` seeds the project
link from the tracked `supabase/project-ref` (not a secret). The access token and
database password are not in the repo or `.env.tpl`; the CLI caches them per
machine after one `supabase login`, shared across worktrees.

```bash
./scripts/utility db-push     # reports drift both ways, then dry-runs; Mike applies
./scripts/utility db-check    # asserts the LIVE schema; run after every push
supabase/tests/run.sh         # replay all migrations in a throwaway local Docker stack
```

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

## Deno tests

```bash
cd supabase
deno task test     # offline unit tests
deno task check    # type-check every function and shared module
```

Config is `supabase/deno.json`, deliberately not `supabase/functions/deno.json`
(the CLI reads that as deploy config) and not the repo root (a `deno.json` next
to `package.json` pulls the whole npm tree into the lockfile).

Both tasks run in `build.yml` (job `verify`) and in `deploy-functions.yml` (job
`test`, which gates `deploy`). The duplication is deliberate: the workflows fire
on separate triggers and race, so gating only in `build.yml` would let an
authorization bug reach the edge runtime while the site build was still running.

Tests never touch the network: `classifyChange`'s one Contents-API read is served
by swapping `globalThis.fetch` for a fixture table. Fixtures in
`functions/_shared/testdata/` include real `work.yaml` files copied from `works/`.
`getFileContent` treats only a 404 as "no work here"; a 500 read as absent would
let a placeholder overwrite a real work, and a test pins it. The placeholder
refusals are pinned in `pending-dispatch.test.ts` (search `REFUSAL:`) and mirrored
in `tests/test_process_pending.py`.
