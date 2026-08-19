# Supabase Backend

Backend infrastructure for the Bluegrass Songbook, hosted on Supabase.

## Components

### Edge Functions (`functions/`)

Serverless functions that run on Supabase Edge (Deno runtime).

| Function | Purpose | Trigger | Source |
|----------|---------|---------|--------|
| `create-flag-issue` | Create GitHub issue for song problem reports | POST from flags.js | `functions/create-flag-issue/index.ts` |
| `create-song-request` | Create GitHub issue for song requests | POST from main.js | `functions/create-song-request/index.ts` |
| `create-superuser-request` | Create GitHub issue for super-user access requests | POST from superuser-request.js | `functions/create-superuser-request/index.ts` |
| `auto-commit-song` | Gate + classify a pending_songs row, then dispatch the write to CI | POST from editor.js (any logged-in save) | `functions/auto-commit-song/index.ts` |
| `cleanup-pending` | Remove pending songs already committed | `.github/workflows/cleanup-pending.yml` after a successful deploy | `functions/cleanup-pending/index.ts` |
| `reconcile-pending` | Retry rows the live commit path failed, and report the drift | `.github/workflows/reconcile-pending.yml`, hourly | `functions/reconcile-pending/index.ts` |

**Shared code (`functions/_shared/`)**

- `identity.ts` — verified identity (`requireUser` / `optionalUser` /
  `attributionFor`). The client never says who it is.
- `pending-dispatch.ts` — the phase 2b change gate: durable per-user rate
  limit counted from `submission_log`, `classifyChange` (create / update /
  fork-to-arrangement / add / metadata), and `dispatchPendingCommit`, which
  fires the `pending-commit` repository_dispatch. **No edge function authors
  work.yaml any more** — `.github/workflows/process-pending.yml` runs
  `scripts/lib/works_writer.py`, the repo's one writer.
  Ownership is answered **per part type**: `submittersOf(yaml, 'lead-sheet')`
  for a chart, `tabPartOwners(yaml, file)` for one tab. It used to be a
  regex over the flat file, which was safe only while `submitted_by`
  appeared on charts alone; tab rows carry it now, and the loose version
  would have let contributing a banjo tab buy an in-place overwrite of that
  work's primary chart (and its title/artist/key with it).
  **`anyPartOwners(yaml)` is a deliberately different, LOOSER question** and
  must not be "fixed" into `submittersOf`: it asks *do you have any stake in
  this work?* and its only caller is the metadata column, which rewrites
  nobody's content. Owning a tab does not buy a rewrite of a stranger's
  lyrics; it does buy the right to say who wrote the song. Both functions
  carry comments saying so, and both directions are pinned by tests.
  `MetadataRefusedError` is the one typed refusal `classifyChange` can
  return (403 no claim / 404 no such work / 400 no target) — the metadata
  column is the only one with nothing additive to land a stranger's edit in.
- `commit-song.ts` — the `PendingSong` shape, one Contents-API read used by
  classification, and `unretryableReason` (which is **part-type aware**: a
  metadata row carries no content by construction, so demanding one would
  have made every metadata row permanently "unretryable" and opened an alert
  issue about a well-formed row an hour after it was written). Phase 2d deleted the
  document-attachment path (and the write helpers only it used) along with
  the doc-upload feature; nothing in here writes to GitHub any more.

`auto-commit-song` (live path) and `reconcile-pending` (hourly retry) both
import `pending-dispatch.ts`, so a retry classifies exactly the way the
original attempt did. Supabase bundles relative imports at deploy time, so
**redeploy both functions** whenever anything in `_shared/` changes.

`reconcile-pending` is gated on the service role key itself (not merely a valid
project JWT — the anon key is public), handles at most 25 rows per run, and
skips rows younger than 15 minutes so it cannot race an in-flight
`auto-commit-song`. It always returns HTTP 200 with `drift` (the count of rows
where `github_committed = false`) and `stuckCount`; the workflow fails and
opens/updates a single "Reconciler: pending songs stuck uncommitted" issue when
`stuckCount > 0`. `POST {"dryRun": true}` measures drift without dispatching.
Rows are marked `github_committed` by the workflow after its push lands —
never by a function, which is what used to let `cleanup-pending` reap songs
that had not actually reached git.

**Deployment:** `.github/workflows/deploy-functions.yml` deploys on push to
main, **after** its `test` job passes. To deploy by hand:
```bash
supabase functions deploy auto-commit-song
supabase functions deploy reconcile-pending
```

#### Tests (`deno test`)

```bash
cd supabase
deno task test     # unit tests — offline, ~60 assertions, <1s
deno task check    # type-check every function and shared module
deno task test:watch
```

Both run in CI twice, and both gate:

| Workflow | Job | Gates |
|---|---|---|
| `build.yml` | `verify` (with pytest + vitest) | every push and PR to main, plus every `workflow_run` from a content workflow named in its trigger list; `deploy` needs it |
| `deploy-functions.yml` | `test` | `deploy` needs it — nothing reaches the edge runtime untested |

The duplication is deliberate: the two workflows fire on separate triggers and
race, so gating only in `build.yml` would let a merged authorization bug reach
production while the site build was still running.

**What is covered, and why that.** `_shared/pending-dispatch.ts` is the change
gate — `classifyChange` decides whether an edit lands **on** somebody else's
content or **beside** it, and a privilege escalation was found and fixed in it
(see `submittersOf` above). Before 2026-08-18 nothing in CI ran Deno at all, so
that decision shipped verified by nothing.

- `functions/_shared/pending-dispatch.test.ts` — `partBlocks`, `submittersOf`,
  `tabPartOwners`, `anyPartOwners`, the full `classifyChange` table for all
  three columns **including the metadata refusal**, the durable rate limit,
  and the escalation pinned in both directions (owning only a tab must
  classify a chart edit `fork`; owning only a chart must classify a tab
  correction `add`). The metadata asymmetry is pinned side by side in one
  test: same user, same work, chart edit → `fork`, metadata edit → `metadata`.
- `functions/_shared/commit-song.test.ts` — `getFileContent`'s 404-is-the-only-
  null rule (a 500 read as "no work here" would let a placeholder overwrite a
  real `work.yaml`) and `unretryableReason`.
- `functions/_shared/testdata/` — fixtures. Four are REAL `work.yaml` files
  copied out of `works/`, so the parser is exercised against the shapes the
  corpus actually contains, including one hand-written file with a different
  indent style and a `composers:` key listed *after* `parts:`.

Nothing touches the network: the pure helpers are called directly, and
`classifyChange`'s one Contents-API read is served by swapping
`globalThis.fetch` for a fixture table (the real base64 decode still runs).

**Ownership parity with Python.** `submittersOf(yaml, partType)` and
`process_pending.owns_content(..., part_type)` are the same question asked on
the two sides of the dispatch, and used to agree only by comment. The
expectations now live in one table —
`functions/_shared/testdata/ownership-cases.json`, against
`how-long-blues.work.yaml` (generated by the real `works_writer`: a primary
chart, a fork, and a tab, three different owners) — and both suites read it:

```bash
cd supabase && deno task test              # .../pending-dispatch.test.ts
uv run pytest tests/test_ownership_parity.py
```

Add a row to the JSON and both sides must agree or one of them goes red.

**Config location.** `supabase/deno.json` — *not* `supabase/functions/deno.json`
(the Supabase CLI reads that one as deploy configuration) and *not* the repo
root (a `deno.json` beside `package.json` makes Deno adopt the whole npm tree
into its lockfile). `supabase/deno.lock` pins the remote imports.

**Known gap.** `partBlocks` splits the part sequence on `/^\s*-\s/`, so a
sequence entry written as a bare `-` with its keys on the following lines —
valid YAML, and a plausible hand-edit — is not recognised as a new entry and
the two parts merge into one block. `blockValue` then reports the first part's
`type:` with the second part's `submitted_by:`, which can hand a tab submitter
ownership of an imported chart. Nothing in the pipeline emits that style
(`works_writer` uses PyYAML's `- key: value`), so it takes a hand-edited or
externally reformatted `work.yaml` to reach. Today's behaviour is pinned by a
test; the fix is `/^\s*-(\s|$)/`, and an `ignore: true` test named
`KNOWN BUG: ...` asserts the correct answer and un-ignores with it.

### Migrations (`migrations/`)

SQL migrations for the Supabase Postgres database. Version-controlled and applied via `supabase db push`.

**Key tables:**
- `user_lists` - User lists with multi-owner support (`owners` array)
- `user_list_items` - Songs in lists (many-to-many)
- `user_favorites` - User favorited songs
- `song_votes` - User votes for song versions; `arr_slug` names WHICH lead
  sheet of the work (null = the work's own chart, the meaning every pre-fork
  row carries). `song_vote_counts` tallies the work level, and
  `song_arrangement_vote_counts` tallies per arrangement
- `tag_votes` - User tag up/downvotes (trusted users can override tags)
- `genre_suggestions` - User-submitted genre suggestions
- `visitor_stats` - Page view and unique visitor counts
- `visitors` - Visitor tracking for analytics
- `analytics_events` - Behavioral analytics events
- `song_flags` - User-reported song issues
- `list_followers` - Users following lists they don't own
- `list_invites` - Invite tokens for list co-ownership
- `admin_users` - Admin users who can delete songs
- `deleted_songs` - Soft-deleted songs (excluded from index at build time)
- `trusted_users` - Users allowed to edit someone else's chart **in place** (everyone else's edit forks to a new arrangement)
- `pending_songs` - Any logged-in user's submission, live in the overlay,
  awaiting the GitHub commit. Parts-aware since
  `20260818000000_pending_songs_tablature.sql`: `part_type` is `lead-sheet`
  (content is ChordPro) or `tablature` (content is a serialized OTF), with
  `instrument` required on the latter and `part_file` naming the works/ file
  a tab CORRECTION targets. The content size cap depends on the kind —
  200KB for a chart, 2MB for an OTF, because multi-track arrangements are
  genuinely that big and the chart cap would have rejected the best tabs at
  INSERT.
  Since `20260818010000_pending_songs_metadata.sql` there is a third
  `part_type`, **`metadata`**: no content at all (a CHECK refuses it), a
  mandatory `replaces_id`, and a write that touches only the work's own
  title / artist / key / notes. It exists because a work minted by a TAB had
  a title and nothing else and no part anybody would want to rewrite in
  order to fix that.
  **Row ids**: a chart row's `id` IS its work slug (one row per song). A tab
  is a PART and a metadata edit is a per-user intent, so both live in their
  own namespaces — `tab:<slug>:<rand>` and `meta:<slug>:<rand>`, enforced by
  `pending_songs_tab_id_namespace` / `pending_songs_metadata_id_namespace` —
  and name their target work in `replaces_id`. Keying them by the work id
  collided on the PK the moment two people tabbed (or retitled) the same
  song, and surfaced as a *permissions* error because the update policy
  gates on `created_by`. `notes` and `status` are capped/enum-checked here
  too; the earlier cap pass skipped them on the mistaken belief (in a
  comment, and in PR #237) that `notes` didn't exist
- `review_requests` - The destructive residue (phase 2d): trusted users request delete / suppress / merge-redirect, admins decide
- `leaderboard_identities` - Opt-in real names for the High Scores board. **RLS on, zero policies** — only `get_leaderboard()` reads it
- `leaderboard_salt` - One random uuid that salts the leaderboard aliases. **RLS on, zero policies.** Never expose it: contributor uuids are already public in `works/*/work.yaml` (`provenance.submitted_by`), so an unsalted alias hash would be a join key straight back to real contributors

**Key functions:**
- `get_leaderboard()` (`20260816120000_leaderboard.sql`, **not yet applied**) —
  the High Scores board, `security definer`, granted to `anon` *and*
  `authenticated`. Aggregates `submission_log` over CONTENT actions only
  (`song_submit`, `song_correction`, `tab_submit`, `tab_correction`; reports
  and requests don't score) and returns
  `(rank, display, total, songs, tabs, is_you)`.
  **The anonymization is the feature.** No email, uuid, or auth metadata for
  any user but the caller is in the response at all — it isn't masked, it
  isn't there. `display` resolves as: opt-in name from
  `leaderboard_identities` → the caller's own email on their own row →
  otherwise a deterministic bluegrass alias from `md5(salt || user_id)` over a
  24 x 24 adjective/noun table, with a two-hex-char suffix added only to rows
  that actually collide. Ships the deterministic-alias half of #174; that
  issue stays open for real profiles. Frontend: `docs/js/high-scores.js`.

**Retired:** `doc_staging` (+ the `doc-staging` storage bucket) — the
document-upload intake, removed in phase 2d. The drop migration
(`20260815130000_drop_doc_staging.sql`) is written but **not applied**: it
opens with a rescue checklist because anything still in that table or bucket
is a submitter's only copy, and the bucket itself needs a manual delete.

### Authentication

Google OAuth via Supabase Auth. User sessions managed by `supabase-auth.js` on frontend.

**Key functions in supabase-auth.js:**
- `signInWithGoogle()` - Initiates OAuth flow
- `getUser()` - Returns current user (sync, from cache)
- `isLoggedIn()` - Boolean check
- `fetchUserLists()` - Get user's lists from database
- `isAdmin()` - Check if current user is an admin (can delete songs)
- `deleteSong(songId)` - Soft-delete a song (admin only)
- `isTrustedUser()` - Check if current user has trusted status (can make instant edits)
- `savePendingSong(song)` - Save song to pending_songs table

**Note:** `supabase-auth.js` is loaded as a regular script (NOT an ES module). Functions are exposed via `window.SupabaseAuth` object.

### Admin Features

Admin users can permanently delete songs from the songbook:

1. Admin user IDs are stored in `admin_users` table (managed via service role)
2. Delete button appears in song view for admins only
3. Songs are soft-deleted to `deleted_songs` table
4. Build process reads `docs/data/deleted_songs.json` and excludes those songs

**To add an admin:**
```sql
-- Run with service role (e.g., in Supabase SQL editor)
INSERT INTO admin_users (user_id) VALUES ('user-uuid-here');
```

**To sync deleted songs for build:**
```bash
./scripts/utility sync-deleted-songs
```

### Contribution Workflow (phase 2b)

Every logged-in user's submission takes the same path — trust gates edit
rights, not speed:

1. The editor writes the row to `pending_songs` (`github_committed: false`).
   RLS allows any authenticated user to insert rows they own; in-place update
   of an existing row stays owner-or-trusted.
2. The song appears immediately in search (`refreshPendingSongs()` merges the
   overlay at load time).
3. `auto-commit-song` verifies row ownership, enforces the durable per-user
   rate limit, classifies the change, and fires the `pending-commit`
   repository_dispatch.
4. `.github/workflows/process-pending.yml` writes it to `works/` via
   `works_writer`, pushes, then flips `github_committed`.

Metadata edits take the same four steps (2026-08-18), minus the content: the
row carries `part_type: metadata`, no `content`, and whichever of
title / artist / key / notes changed, and `process_pending.py` writes them
through `works_writer.update_metadata`. A caller with no claim on the work is
refused at step 3 with a 403 the client can show; the row stays in the table
and the hourly reconciler files it as `unretryable` rather than retrying it
forever.

Tabs take the same four steps (2026-08-18). The row carries the serialized
OTF in `content` plus `part_type: tablature` / `instrument` / `part_file`,
and `process_pending.py` writes `works/<id>/<instrument>[-N].otf.json`
through the same writer. This replaced `create-tab-pr` +
`process-tab-pr.yml`, which are **deleted** — a tab is no longer
review-gated, and the "accepted exception" in the plan's phase 2b is closed.

Classification — **lead sheet**:

| Situation | Result |
|---|---|
| no work at the target id | `create` |
| the caller's uuid appears in a **lead-sheet** part's `provenance.submitted_by` | `update` in place |
| the caller is in `trusted_users` | `update` in place |
| anything else | `fork` — a new arrangement part; the original is untouched |

Classification — **tablature**:

| Situation | Result |
|---|---|
| no work at the target id | `create` — the tab mints the work, slug from the TITLE (the row id is synthetic) |
| `part_file` names a tablature part whose `submitted_by`/`author` is the caller | `update` in place |
| `part_file` names a tablature part and the caller is in `trusted_users` | `update` in place |
| anything else (new tab, unknown file, someone else's tab) | `add` — a NEW sibling part; the original is untouched |

`add` is the tab column's `fork`: a "correction" from a non-owner becomes
another take on the instrument rather than a rewrite. Ownership is asked of
parts of the **same kind** on both sides of the dispatch
(`submittersOf(yaml, partType)` / `process_pending.owns_content(..., part_type)`)
— owning a tab is not owning a chart.

Classification — **metadata** (the work's own title / artist / key / notes;
no part is created, replaced, renamed or reordered and no part file is
written):

| Situation | Result |
|---|---|
| the caller is in `trusted_users` | `metadata` — full edit privileges, any work |
| the caller's uuid appears on **any** part of the work (`submitted_by` on a chart or tab, `author` on a tab) | `metadata` |
| anything else | **REFUSED** — 403 `MetadataRefusedError`, never a silent fork |
| no work at `replaces_id` | **REFUSED** — 404. Never a `create`: there is no content to seed a work from |
| no `replaces_id` at all | **REFUSED** — 400. The `meta:…` row id is a PK, not a work slug |

This is the one column that refuses, and the one that asks the loose
ownership question (`anyPartOwners`). Both follow from the same fact: no
content is rewritten by naming an artist, so contributing anything earns the
right — and a second opinion about a title is not an arrangement, so there
is nowhere additive to put a stranger's edit. Silently forking one would put
a duplicate work in the corpus every time somebody fixed a typo they were
not entitled to fix.

The action logged for it is **`metadata_edit`**, which `get_leaderboard()`
does not count (it aggregates `song_submit`, `song_correction`, `tab_submit`,
`tab_correction` only). A metadata tweak is neither a song nor a tab; it
still lands in `submission_log`, so it still counts against the durable rate
limit and is still auditable.

**To add a trusted user:**
```sql
INSERT INTO trusted_users (user_id, created_by)
VALUES ('user-uuid-here', 'admin-manual');
```

**To request trusted status:** Regular users can request super-user access through the app. This creates a GitHub issue via `create-superuser-request` edge function. Admin approves by adding to `trusted_users` table and closing the issue.

### Review queue (phase 2d)

Adding content is instant; destroying it is not. `review_requests` holds the
three destructive asks — `delete`, `suppress`, `merge-redirect`:

- **trusted** users file requests (RLS: insert requires `is_trusted_user()`
  *and* `requested_by = auth.uid()`) and can read the whole queue.
- **admins** decide. Only `is_admin()` may update `status`, and a trigger
  stamps `reviewed_by` / `reviewed_at` from the session while freezing the
  request's immutable fields. Nobody can delete rows — the queue is the audit
  trail.
- Admins keep their **instant** delete on the song page. They are the
  reviewers; making them queue an ask to themselves would be ceremony.

The UI is `docs/js/review-queue.js`, rendered into `#review-queue-panel` in
the Bluegrass Dungeon (the same place Promote lives). Its third section lists
`pending_songs` rows held by the phase-3b dedup backstop (`dedup_hold` not
null) with admin *Release hold* / *Reject* actions — which is why
`20260815150000_review_requests.sql` also adds `is_admin()` update/delete
policies on `pending_songs`: the 2b policies grant those to the row's author
or a trusted user only, so an admin outside `trusted_users` would have been
refused by RLS.

**What approval actually does — the honest part.** Approving a `delete` runs
the existing `delete_song` RPC, so the song is gone immediately. Approving a
`suppress` or `merge-redirect` only records the decision: both edit files in
the repo (`curation/registry.yaml`, `works/`), and nothing in CI performs
those from a table. The panel therefore shows the request as *"Approved — run
locally"* and prints the command:

```bash
./scripts/utility curate suppress <work-id> --reason "..."
# merge-redirect: a one-entry plan for the existing merge tool
uv run python scripts/lib/merge_works.py /tmp/merge-plan.json --execute
```

## Row-Level Security (RLS)

All tables have RLS policies:
- Lists: Owners can CRUD, anyone can read public lists
- Votes: one vote per user per version — `(user_id, song_id, arr_key)`, where
  `arr_key` is a generated `coalesce(arr_slug, '')` (a plain nullable column
  could not carry a unique constraint, and PostgREST cannot arbitrate an
  upsert on an expression index)
- Stats: Increment-only via function

## Local Development

```bash
# Start local Supabase
supabase start

# Apply migrations
supabase db push

# Test edge functions locally
supabase functions serve auto-commit-song --env-file .env.local
```

## Environment Variables

Edge functions require:
- `GITHUB_TOKEN` - PAT with repo scope for issue creation
- `GITHUB_OWNER` - Repository owner (e.g., "Jollyhrothgar")
- `GITHUB_REPO` - Repository name (e.g., "Bluegrass-Songbook")

Set via Supabase dashboard > Edge Functions > Secrets.

## Working with migrations from a worktree

`supabase/.temp/` is gitignored CLI state, so a fresh worktree starts unlinked
and every `supabase` command fails with *"Cannot find project ref"*.
`scripts/bootstrap` now seeds it from the tracked `supabase/project-ref`. That
value is not a secret — it is the subdomain of the public `SUPABASE_URL`, which
every browser request already carries.

The **access token and database password are not** seeded and are not in
`.env.tpl`. The CLI caches them per machine (macOS keychain) after a single
`supabase login`, and that cache is shared across worktrees — which is why a
push works from any worktree once the link is present.

```bash
./scripts/utility db-push     # lists pending migrations, then dry-runs
```

Read the dry run before pushing. Two traps it exists to surface:

* **Out-of-order migrations.** A migration dated earlier than the last one
  already applied is refused by a plain `db push`, with a message that reads
  like a failure. It needs `--include-all`, which applies *every* pending
  migration — so check what else comes along for the ride.
* **Never renumber or edit an applied migration.** Add a new one. Rewriting a
  file that some environments have run and others haven't is how you get
  databases that disagree about their own schema.

A timestamp collision is silent and ugly: two files sharing a version prefix is
ambiguous to the CLI. Check `ls supabase/migrations/ | sed 's/_.*//' | uniq -d`
before naming a new one.
