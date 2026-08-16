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
  fork-to-arrangement), and `dispatchPendingCommit`, which fires the
  `pending-commit` repository_dispatch. **No edge function authors work.yaml
  any more** — `.github/workflows/process-pending.yml` runs
  `scripts/lib/works_writer.py`, the repo's one writer.
- `commit-song.ts` — the `PendingSong` shape, one Contents-API read used by
  classification, and `unretryableReason`. Phase 2d deleted the
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
main. To deploy by hand:
```bash
supabase functions deploy auto-commit-song
supabase functions deploy reconcile-pending
```

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
- `pending_songs` - Any logged-in user's submission, live in the overlay, awaiting the GitHub commit
- `review_requests` - The destructive residue (phase 2d): trusted users request delete / suppress / merge-redirect, admins decide

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

Classification:

| Situation | Result |
|---|---|
| no work at the target id | `create` |
| the caller's uuid appears in the work's `provenance.submitted_by` | `update` in place |
| the caller is in `trusted_users` | `update` in place |
| anything else | `fork` — a new arrangement part; the original is untouched |

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
