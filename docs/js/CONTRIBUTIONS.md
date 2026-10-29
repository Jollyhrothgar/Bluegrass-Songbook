# Contributions: what the client assumes

Read this before changing `otf-editor/submit-tab.js`, the pending overlay in
`corpus.js`, `submitWorkMetadata` in `work-view.js`, `review-queue.js` or
`add-song-picker.js`. Server behavior is in `supabase/CLAUDE.md`.

- Every logged-in submission is a `pending_songs` row (visible at once through
  `refreshPendingSongs()`), then a POST of its id to the `auto-commit-song` edge
  function, which dispatches `process-pending.yml` into `works/`. The response
  says what the server decided: `{mode: 'create' | 'update' | 'fork'}`. The
  client never claims one. `isTrustedUser()` only decides in-place edit of
  others' charts and who may file review requests.
- Content writes require login; the client never sends who the submitter is (the
  edge function derives it from the verified session). Reports
  (`create-flag-issue`) and requests (`create-song-request`, anonymous branch)
  work without an account. The GitHub-issue and tab-PR flows (`create-song-issue`,
  `create-tab-pr`) are deleted; nothing may call them.
- Tabs: `submit-tab.js::submitTab` writes the row (`part_type` `'tablature'`,
  required `instrument`, `part_file` = the `works/` file a correction targets,
  `content` = serialized OTF), then POSTs the id to `auto-commit-song`. It resolves when the tab is live and
  returns `{id, workId, instrument, partFile, live, synced, mode, syncError}`.
  `synced: false` is not a failure: the hourly reconciler retries, so say "live,
  syncing shortly". Same-instrument siblings are normal, so the server adds a
  uniquely named part rather than 409ing. A correction names its take by
  `src_file`.
- Before the tab editor opens on a work with tabs for that instrument,
  `existing-tabs.js::tabEntryPlan` (reads `tablature_parts` off the index row)
  offers view / add another version / import .tef / improve this one.
- The overlay is parts-aware (`corpus.js`): a pending tab attaches to its work's
  `tablature_parts` (`overlayPendingTabParts`: a `part_file` match replaces that
  take, otherwise append) and only becomes its own row if nothing published the
  work yet. `loadPartOtf` parses the overlay's `content` for a pending take;
  `otfCacheKey(part)` keys it by overlay row, because a correction keeps the
  `file` of the take it fixes and would otherwise render the version it corrects.
- Work details (title/artist/key/notes) are the work's, not a part's. The
  "Details" button (`#edit-meta-btn`, `.focus-btn`; not `.qc-btn`, which is the
  icon-only tab-band button and never holds a word) is gated by
  `utils.js::canEditWorkMetadata`: own a part of the work (`workSubmitters` reads `submitted_by` off the index row's chart, `arrangements[]`, `document_parts[]` and `tablature_parts[]`), or be trusted. The server is authoritative either way.
  `submitWorkMetadata` writes a `pending_songs` row with `part_type: 'metadata'`,
  `content: null`, `replaces_id` = the work (required) and id `meta:<slug>:<rand>`
  (a DB CHECK), then POSTs to `auto-commit-song`. Unlike tabs, a 4xx there
  (403/404/400, not 429) means refused: the row is deleted and the server message
  shown. `corpus.applyPendingMetadata` (last in `mergeCorpus`) merges fields onto
  the named work only; it never mints a row, touches parts, or flags the work
  pending, and the newest `created_at` wins.
- Song requests (`add-song-picker.js`, `#request-song`) go through
  `create-song-request`. A request for a song already in the book gets a 409
  that the picker shows; there is deliberately no suffixed fallback (an empty
  placeholder at `foo-1` would be a bounty entry for a song we have).
- Review queue (`review-queue.js`, in the Dungeon): admins delete instantly;
  trusted non-admins file `review_requests` rows (delete, suppress,
  merge-redirect). Approving a delete runs the `delete_song` RPC; approving a
  suppress (hide a work from search: `curate suppress`) or merge-redirect (fold a
  duplicate work into another and redirect its URL: `merge_works.py`) only
  records the decision and shows the command `review-queue.js::localCommandFor`
  builds (`./scripts/utility curate suppress <id> --reason "..."`, or
  `uv run python scripts/lib/merge_works.py <plan.json> --execute`), because
  those edit repo files and no CI path runs them. Rows with `pending_songs.dedup_hold`
  set get Release hold / Reject here. `process_pending.py` sets it when it refuses
  a write that waiting will not fix: `dedup_scorer.py` found the create a
  near-duplicate of an existing work, the target work is suppressed or merged
  away, or a song request's slug already holds a work. The hourly reconciler
  skips held rows, so a human releases (re-dispatch) or rejects (delete).
- Document upload is gone, but document parts already in `works/` render
  (`renderDocumentPart` in work-view.js).

## Surviving the sign-in redirect (`auth-return.js`)

Google sign-in is a full-page redirect and the session returns in the URL
fragment (implicit flow), so the route cannot ride in `redirectTo`. Instead
`persistReturnRecord()` (called by `requireLogin()` in `utils.js`, the tab gate in
`otf-editor/create-tab-entry.js` and the auth modal) saves
`localStorage['bgb-auth-return']` (30 min TTL, single use): the route plus
whatever the open editor adds through `registerReturnSource(fn)`. `AUTH_REDIRECT`
is read at import time, before supabase-js strips the fragment, and only a page
that really came back from the redirect applies a record
(`main.js::resumeAfterAuthRedirect`, then `stageEditorRestore` /
`applyEditorRestore`). It never submits for the user.
`e2e/editor-lifecycle.spec.js` runs the real SDK against a mock OAuth endpoint
(`mockSupabase(page, {oauthReturn: true})`); a stubbed `signInWithGoogle` cannot
see the bug this guards against (the route and unsaved editor text lost after
the redirect). Known limit: the tab submit panel's comment is not carried over.

