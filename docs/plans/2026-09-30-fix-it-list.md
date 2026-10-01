# Fix-it list — 2026-09-30

A whole-app audit (speed, cross-device sync, the lyrics/chords editor, the tab
editor, songbooks, visual design) produced this list. It is the working
backlog for making the app feel like **one book**:

1. **One of everything** — one ChordPro parser, one list store, one set of
   design tokens, one button, one draft system.
2. **The page is the music** — chrome recedes, density fits the device.
3. **Nothing lost, nothing stale** — edits are kept, deletes stick, every
   device sees the same library.

Every item has an ID. Refer to items by ID in branches, commits, PRs and
issues (`fix(A4): ...`). Update the **Status** column when an item moves.

**Order:** A first (A1 leads). B and F1–F2 can run alongside; F6 mockups any
time. Then C, then D and E on top of C.

Sizes: **S** = hours, **M** = a day or two, **L** = a week or more.
"Verified" says how the problem was confirmed on 2026-09-30: **live** =
reproduced on bluegrassbook.com, **code** = confirmed by reading the source.

## Status

| ID | Item | Size | Branch | Status |
|----|------|------|--------|--------|
| A1 | List ownership RPCs + list read policies | M | `bug/list-security` | review passed — needs prod `db-push` |
| A2 | Analytics `log_events` broken since 2026-01-07 | S | `bug/list-security` | review passed — needs prod `db-push` |
| A3 | Shared list links show 0 songs | S | `bug/list-security` | review passed |
| A4 | Lyrics outside section tags render blank | S | `bug/chordpro-untagged-lines` | review passed |
| A5 | Sign-in at Submit loses the work (both editors) | S–M | `bug/editor-lifecycle` | review passed |
| A6 | Setlist keys Eb/Ab/Bb and minor keys ignored | S | `bug/setlist-keys-not-found` | review passed |
| A7 | Editor stays on screen after navigating away | S | `bug/editor-lifecycle` | review passed |
| A8 | Practice line: Strum Machine + YouTube search | S | `feature/practice-line-contrast` | review passed |
| A9 | Dark-mode contrast + undefined CSS variables | S | `feature/practice-line-contrast` | review passed |
| A10 | Deleted-duplicate URLs say "Song not found" | S | `bug/setlist-keys-not-found` | review passed |
| A11 | Stale / wrong editor copy | S | `bug/editor-lifecycle` | review passed |
| B1 | Collection thumbnails 5.35 MB → ~50 KB | S | `feature/perf-thumbnails` (+ render gating in `feature/perf-boot-data`) | review passed |
| B2 | Archive loads on every page | M | `feature/perf-boot-data` | review passed |
| B3 | First render waits on Supabase, no timeout | M | `feature/perf-boot-data` | review passed |
| B4 | Render-blocking third-party scripts | S | `feature/perf-boot-head` | review passed |
| B5 | Theme flash; OS preference ignored | S | `feature/perf-boot-head` | review passed |
| B6 | Legacy-ID map fetched for everyone | S | `feature/perf-boot-data` | review passed |
| B7a | Route-specific modules loaded at boot | M | `feature/perf-lazy-modules` | review passed — rebase before merge |
| B7b | Service worker, prefetch, double renders | M | `feature/perf-sw-render` | review passed |
| C1 | List store rework | L | — | not started |
| C2 | Song index freshness | M | — | not started |
| D1–D7 | Library building blocks | L | — | blocked on C1 |
| E1–E6 | Editors | M–L each | — | not started |
| F1–F6 | Visual design | M–L | — | not started |

### Merge order for the in-flight branches

Several branches touch `docs/js/main.js`, `docs/index.html`,
`docs/js/work-view.js` and `docs/css/style.css` in different regions. Merge in
this order and rebase the rest after each merge:

1. `bug/list-security` (needs a production `db push` — see "Production steps")
2. `bug/chordpro-untagged-lines`
3. `bug/setlist-keys-not-found`
4. `bug/editor-lifecycle`
5. `feature/practice-line-contrast`
6. `feature/perf-boot-head`
7. `feature/perf-thumbnails`
8. `feature/perf-boot-data`
9. `feature/perf-sw-render`
10. `feature/perf-lazy-modules` (largest import-graph change; last)

Open PR #271 (`feature/responsive-toolbar`, top band) also edits `shell.js` and
`style.css`; land it before or after the A8/A9 branch, not interleaved.

Integration check (2026-09-30): branches 1–9 merge in this order with no
conflicts, and the combined tree passes 127 vitest files / 3,129 tests and the
full Playwright suite (402/402). `feature/perf-lazy-modules` conflicts with
the combined tree in `docs/index.html`, `docs/js/main.js`,
`docs/js/work-view.js`, `docs/js/sw-strategy.js` and its test, so rebase it
onto main after the others land. Its unit test names the exact
modulepreload / `LAZY_MODULE_URLS` differences to fix after the rebase.

### Production steps

**A1/A2** — migrations `20260930000000_list_ownership_and_read_policies.sql`
and `20260930010000_fix_log_events_search_path.sql` in `bug/list-security`.
Nothing has been applied to production. In order:

1. `./scripts/utility db-push` and read the dry run. Expect NOTICEs for
   `backfilled owners on N legacy list(s)` (lists created before multi-owner
   had an empty `owners`; without the backfill the new read policy would hide
   them from their creators), one `dropping read policy …` per SELECT policy
   removed, and `keeping ALL policy …` for any ALL policy kept. If it aborts on
   the ALL-policy postcondition, a dashboard-made `ALL … TO public` policy
   exists and needs a look.
2. `./scripts/utility db-check`. The four new invariants
   (`lists.reads-closed`, `add_list_owner.locked`,
   `remove_list_owner.self-only`, `log_events.qualified`) fail before the push
   by design.
3. `psql "$PROD_DB_URL" -X -f supabase/tests/post_deploy_check.sql`: no FAIL
   rows. Read the INSPECT rows: `submit_flag` and `get_visitor_flag_count`
   exist only in production (their CREATE is not in the repo), so their bodies
   are printed for a human to check for unqualified table names.
4. `psql "$PROD_DB_URL" -X -f supabase/tests/post_deploy_probe.sql`: the last
   line must be `NOTICE: PASS: post_deploy_probe.sql` with no ERROR line. It
   runs inside a rolled-back transaction.
5. Browser smoke test: a signed-out share link shows its songs; Follow, Claim
   and Leave work; an older account's lists still show after sign-in; the
   Network tab shows `rpc/log_events` returning 200.
6. Re-record `tests/fixtures/schema/live_public_schema.sql` from
   `supabase db dump --schema public`.

The local harness (`supabase/tests/run.sh`, Docker) replays every migration
and runs all of the above against a throwaway local stack; see
`supabase/tests/README.md`.

**B7b** — no data steps. On the first deploy, check that a returning browser
picks up the new `sw.js` and shows the "Updated — reload" toast. An
intermittent navigation hang during service-worker handover was seen in
headless Chromium on main (4/40) and on the branch (8/40); watch for it.

### Follow-ups found during the 2026-09-30 run

Not fixed in the branches above, recorded so they are not lost. Each names
the plan item it belongs with.

- **Lists / sync (C1, D5)**
  - `handleInviteLink` (main.js) reads `result.error` as a string (shows
    `[object Object]`) and `result.list_id` (undefined; the shape is
    `{ data: { list_id }, error }`).
  - `fetchCloudLists`'s orphan-repair loop updates rows the new owners-only
    policy filters out, and can resurrect a list its creator left.
  - `is_list_owner` / `is_list_follower` accept any user id, so a signed-in
    user can probe membership if they know both UUIDs. `claim_list_invite`
    does not guard `auth.uid() IS NULL`.
  - `getOrCreateFavoritesList` (supabase-auth.js) has no callers and would
    fail under the new INSERT policy; delete it.
  - The analytics re-queue cap does not actually cap a poison batch; bounded,
    not a loop.
  - `supabase/tests/baseline/` reconstructs dashboard-made tables for the
    local harness; committing real CREATE migrations from a production dump
    would retire it.
- **Editors (E2)**
  - Navigating to `#add` while editing an existing song resets the editor
    without the leave prompt (the view stays `add-song`).
  - `enterEditMode` for a different song while the editor has edits
    overwrites them silently.
  - After a successful new-song submit the editor keeps the text, so the next
    Add Song shows it.
  - The lead-sheet editor still has no persistent draft (the A5 return record
    only covers the sign-in trip); the tab submit panel's comment is not kept
    across sign-in.
- **Parser (E1)**: the `\u0001` in-section comment marker from A4 should
  become a structured line in the shared parser; an unterminated
  `{start_of_tab}` or `{start_of_abc}` swallows the rest of the song.
- **Keys / redirects (D4, data)**
  - List items stored under a legacy id that `redirects.json` maps lose their
    key override (metadata is looked up by the resolved id).
  - List-row key badges show the raw stored key (`D#`); the work-view key
    pickers are major-only.
  - `deleted_songs.json` should record a survivor pointer; the A10 id-stem
    rule covers only same-stem duplicates (3 of the 5 current deleted ids).
- **Contrast (F1)**: `.auth-toast` is white on `--success` (1.74:1 in dark);
  `.collection-image` falls back to white on accent; hardcoded Flat-UI and
  Bootstrap reds (`#e74c3c`, `#dc3545`) on danger hovers;
  `images/strum_machine.png` is now unreferenced.
- **Speed (B, C2)**
  - 46 canon groups (~1.9%) have an archived sibling, which the "N versions"
    badge and arrangement pill miss until something loads the archive.
    **Owner decision**: accept, or have the build emit a group size.
  - `#list/<id>/<song>` still builds the landing cards; overlays that land
    after the 800 ms grace re-run search but do not redraw an open list view.
  - Favorites deep links wait for the whole archive when favorites hold any
    id the canon lacks.
  - Offline: an archived song in a list works offline only after it was
    opened online once; offline boot waits ~7 s on the Supabase overlay
    retries; abcjs is not precached, so offline ABC shows raw text.
  - The service worker now precaches ~45 lazy modules (~250 KB gzip) at first
    install, off the critical path.
  - GitHub Pages sends `max-age=600`, so a deploy reaches returning visitors
    up to 10 minutes late.
  - Other pages (about, blog, chord-explorer) do not follow the OS theme.
  - Large unaudited images: `images/Mike.png` (4.4 MB), `images/waltz.png`.
- **Navigation (D6)**: after going back from a song to search, Forward is
  lost because the search view pushes a new history entry.

---

## A. Broken now — fix first

### A1 — List ownership RPCs + list read policies · M · verified: code

**Problem.** Two `SECURITY DEFINER` functions that change list ownership do
not check who is calling them, and the read policies on the list tables let
anyone read every list.

- `add_list_owner(p_list_id, p_user_id)` is granted to `authenticated` and
  adds any user id to any list's `owners`
  (`supabase/migrations/20260109224000_multi_owner_lists.sql:220-235, 526`).
  Its only legitimate caller is `claim_list_invite` (same file, line 387).
- `remove_list_owner(p_list_id, p_user_id DEFAULT auth.uid())` accepts any
  `p_user_id` and only checks that *that* user is an owner, not the caller
  (lines 239-303, 527). Removing the last owner of a list with no followers
  deletes the list (line 285).
- `user_lists`, `user_list_items` and `list_followers` have
  `FOR SELECT USING (true)` (lines 47-49, 123-125, 150-152). Item metadata
  holds users' private notes. "Share by link" does not need table-wide reads:
  the link view goes through `get_public_list` (security definer).

**Fix.** One new migration (next free timestamp after
`20260819010000`; check for prefix collisions as `supabase/CLAUDE.md`
describes):

- `REVOKE EXECUTE ON FUNCTION add_list_owner(uuid, uuid) FROM PUBLIC, anon,
  authenticated;` (functions are executable by PUBLIC by default). Keep the
  function for `claim_list_invite`, which runs as the definer.
- Redefine `remove_list_owner` so it only ever removes `auth.uid()`; keep a
  signature the client can call as `rpc('remove_list_owner', { p_list_id })`
  (`docs/js/supabase-auth.js:998`). Reject when `auth.uid()` is null.
- Replace the three `USING (true)` read policies: a user may read a list (and
  its items) when they are in `owners` or follow it; followers rows are
  readable by the follower and by the list's owners. Check every client read
  path still works: own lists (`supabase-auth.js:408-525`), followed lists
  (`:828-856`), sync, claim, invite.
- Keep `get_public_list` as the way to view a shared list by id. Keep it
  `SECURITY DEFINER` with a pinned `search_path`.
- Self-verifying: follow "Self-verifying migrations" in `supabase/CLAUDE.md`.

**Acceptance.** An authenticated non-owner cannot add or remove owners or
delete a list through any RPC; anon cannot read any list table directly; an
owner and a follower still can; share links, invites, claim and leave still
work.

**Tests.** Exercise the migration against a local database (the Supabase CLI
and Docker are installed; `supabase start` / `supabase db reset` run locally).
Never test against production.

### A2 — Analytics `log_events` broken since 2026-01-07 · S · verified: live

**Problem.** Every `rpc/log_events` call returns 404 with
`relation "analytics_events" does not exist` (PostgREST `42P01`).
`20260107010000_fix_function_search_path.sql` set `search_path = ''` on
`log_events`, whose body names `analytics_events` unqualified.
`log_visit` hit the same issue and was repaired by
`20260111000000_repair_visitors_table.sql`; `log_events` never was.
The client never notices: `supabase.rpc` resolves `{ error }` instead of
throwing, so the re-queue in `docs/js/analytics.js:76-85` never runs.

**Fix.** In the A1 migration (or its own), redefine `log_events` with
schema-qualified names (`public.analytics_events`) and keep the empty
`search_path`. Check the other functions that migration touched
(`get_public_list`, `submit_flag`, `get_visitor_flag_count`,
`get_visitor_stats`, `update_updated_at`) for the same unqualified-name bug.
In `analytics.js`, treat `{ error }` as a failure so events re-queue.

**Acceptance.** A `log_events` call against a local database inserts rows;
the client re-queues on `{ error }`.

### A3 — Shared list links show 0 songs · S · verified: code

**Problem.** `showListView` reads `data.list.songs`, `data.isOwner`,
`data.list.is_orphaned`, `data.canClaim` (`docs/js/lists.js:2125-2129`).
`get_public_list` returns top-level `songs`, `is_owner`, `is_follower`,
`is_orphaned`, `can_claim` (migration `20260109224000:509-519`), and
`fetchPublicList` passes it through unchanged (`supabase-auth.js:757-781`).
`fetchListData` (`lists.js:2398-2409`) reads the right keys.

**Fix.** Normalize the RPC shape in one place (`fetchPublicList`) and use it
in every caller. Add a unit test with the real RPC shape.

**Acceptance.** Opening a share link in a signed-out window shows the songs;
the Claim button appears for followers of an orphaned list.

### A4 — Lyrics outside section tags render blank · S · verified: live

**Problem.** `parseChordPro` (`docs/js/renderers/chordpro.js:74-97`) only
opens sections for `{start_of_verse|chorus|bridge}` and drops every lyric line
outside one. `works/baby-shark` renders blank on production. The editor
disagrees: `visual-editor/model.js:20-23, 97-101` accepts any `start_of_*`,
the `{sov}`/`{soc}`/`{sob}` shorthands, and treats blank-line-separated blocks
as verses, and the editor placeholder says "A blank line starts a new verse".
Pasted sheets with Intro/Outro/Tag sections publish with those sections
missing.

**Fix (root, minimal).** The song-page parser never drops a lyric line:

- untagged lines form implicit verse blocks, split on blank lines, exactly as
  the editor model does;
- any `{start_of_X[: label]}` / `{end_of_X}` opens/closes a section of type X
  (label defaults to the capitalised type), plus the `{sov}`, `{soc}`,
  `{sob}`, `{eov}`, `{eoc}`, `{eob}` shorthands;
- ABC blocks keep their current handling;
- `{comment: ...}` / `{c: ...}` render as a small label line instead of being
  dropped.

Keep the output shape `{metadata, sections:[{type,label,lines,repeatOf?}]}`
so callers are unaffected, and make sure CSS has a sensible default for
section types it has not seen. This is a down payment on E1 (one parser); do
not attempt the full merge here.

**Tests.** Vitest over the renderer: untagged content, shorthands,
intro/outro, comments, ABC untouched. Add a corpus check: no `works/*/*.pro`
yields a lead sheet whose rendered lyric-line count is lower than its
non-directive, non-ABC line count.

### A5 — Sign-in at Submit loses the work · S–M · verified: code

**Problem.** Both editors call `requireLogin` → `signInWithGoogle`
(`docs/js/utils.js:274-277`), a full-page OAuth redirect whose return address
is `origin + pathname` (`docs/js/supabase-auth.js:69-75`): the `#add`,
`#edit/{id}` or `#work/.../edit/...` route is dropped, and nothing restores
it. The lead-sheet editor has no draft storage at all, so its text is gone;
the tab editor's work survives only under ⋯ → Drafts, and only if the 1s
autosave fired. `e2e/editor.spec.js:106-109` stubs the sign-in, so tests never
see the redirect.

**Fix.** Before redirecting, save a return record (route hash plus, for the
lead-sheet editor, the textarea content and the metadata fields; for the tab
editor, a flushed draft id) in `sessionStorage` or `localStorage`. After
`SIGNED_IN`, if a return record exists, route back to it and restore the
content, then show "Signed in — ready to submit" (do not auto-submit). Do not
put the hash into `redirectTo`: Supabase uses the URL fragment for its own
tokens. Clear the record once used, and expire stale ones.

**Acceptance.** Signed out: write a song, press Submit, complete sign-in → you
are back in the editor with your text; same for a tab edit.

### A6 — Setlist keys Eb/Ab/Bb and minor keys ignored · S · verified: code

**Problem.** The notes sheet stores `"D#"`, `"G#"`, `"A#"`, `"C#"`, `"F#"`
(`docs/index.html:216-229`). `initKeyState` maps only `"D#/Eb"`-style labels
(`docs/js/song-view.js:310-314`), then resets any key not in
`CHROMATIC_MAJOR_KEYS` (which uses Eb/Ab/Bb) or, for minor songs,
`CHROMATIC_MINOR_KEYS` (`song-view.js:320-323`). Result: Eb/Ab/Bb overrides and
every override on a minor song are silently ignored.

**Fix.** One `normalizeKeyForMode(key, mode)` helper (in `chords.js`) that maps
enharmonics to the spelling the key lists use and, for minor songs, maps a
root to its minor key name. Use it where overrides are read, so existing
stored values (`"D#"`, `"A#"`, …) work without a data migration. Make the
picker's option values use the canonical spellings for new saves.

**Tests.** Unit tests for every picker value × major/minor.

### A7 — Editor stays on screen after navigating away · S · verified: live

**Problem.** Opening the lead-sheet editor from a song page bypasses
`showView` (`docs/js/editor.js:195-205`), so app state still says "song page".
`setCurrentView` is a no-op when the value is unchanged (`state.js:432`), so a
later navigation to another `#work/...` leaves the editor visible (reproduced:
editor open → change hash → editor still shown under the new URL).

**Fix.** Entering the editor goes through the router/`showView` like every
other view; leaving the editor route hides it. While there, add an
unsaved-changes confirm when leaving the editor with edits (plain in-page
prompt, not `window.confirm`).

**Tests.** E2E: open editor, navigate by hash and by Back, assert the editor
is hidden and the song page shows the new song.

### A8 — Practice line: Strum Machine + YouTube search · S · verified: live

**Problem.** 709 songs have `strum_machine_url`, but since the unified song
page (`d12ea5416`) the button lives inside the Key pill popover
(`docs/js/song-controls.js:84-140`), and works with no lead sheet get no Key
pill (`docs/js/work-view.js:981`), so 27 songs — Foggy Mountain Breakdown,
Earl's Breakdown, Devil's Dream… — have no way to reach it.

**Fix.** A quiet, always-visible **Practice** line under the title/artist on
every song page (lead sheet or tab):

- **Strum Machine** when `strum_machine_url` exists, passing `?key=` with the
  current key as today;
- **YouTube** for every song: a link to
  `https://www.youtube.com/results?search_query=` +
  `encodeURIComponent(title + ' bluegrass')` — no artist (many songs have many
  covers), no embed.

Both open in a new tab (`rel="noopener"`). Remove the Strum Machine button
from the Key pill so there is one place. Style with existing tokens; no new
boxes.

### A9 — Dark-mode contrast + undefined CSS variables · S · verified: code

**Problem.**

- 17 custom properties are used but never defined (`--text-muted` ×16,
  `--error` ×11, `--text-primary`, `--border-color`, `--bg-tertiary`,
  `--bg-hover`, `--accent-color`, `--text-tertiary`, `--surface`, `--radius`,
  `--primary`, `--primary-dark`, `--mono`, `--danger-dark`, `--bg-primary`).
  Without a fallback the declaration drops: square corners in the Display pill
  (`style.css:1197`), dead hover (`:1219`), transparent Undo button
  (`:1811/1822`), missing dashed border (`:888`). The OTF editor's injected CSS
  uses `var(--bg-hover, #e9e9e9)`, so dark-mode menus show white on light grey.
  (`--bottomband-h` and `--collection-color` are set from JS; leave them.)
- White text on `--accent` / `--danger` is 2.5–2.8:1 in dark mode
  (`--accent` is `#60a5fa`) across ~52 rules, e.g. `.pill-mode-btn.active`
  (`:10417`), `.topbar-action-btn.primary` (`:10032`).

**Fix.** Define the missing names as aliases of real tokens in `:root` (and
dark where the value differs). Add `--on-accent` / `--on-danger` (light:
white; dark: a near-black that reaches ≥4.5:1) and use them wherever text sits
on those fills. No other visual changes in this item.

### A10 — Deleted-duplicate URLs say "Song not found" · S · verified: live

**Problem.** `#work/blue-moon-of-kentucky` — the example in `CLAUDE.md` and
`APP_SPEC.md` — shows "Song not found … may have been renamed or removed",
because that work was deleted as a duplicate of `blue-moon-of-kentucky-1`
(`docs/data/deleted_songs.json` has no pointer to the survivor). Work URLs are
promised to be permanent.

**Fix.** On the not-found page, suggest the closest surviving works by title
(reuse the search/title-normalization code, e.g. `title-match.js`), with a
one-click "Open". When the missing id is in the deleted set and exactly one
surviving work has the same normalized title and the same id stem (the id
minus a trailing `-N`), redirect to it with `history.replaceState`. Do not
change the data pipeline in this item.

### A11 — Stale / wrong editor copy · S · verified: code

- `docs/index.html:249` says "Submissions are reviewed before being added to
  the songbook"; submissions go live immediately.
- `ownsContent` (`docs/js/editor.js:855-862`) ignores trusted status, so
  trusted users are told "This will be saved as your arrangement — the original
  stays untouched" (`:885`) while the server updates in place
  (`supabase/functions/_shared/pending-dispatch.ts:536,548`).
- The Edit Comment field (`index.html:270-273`) is collected but never sent
  (missing from `pendingEntry`, `editor.js:1109-1130`) — either send it or
  remove the field.

**Fix.** Make every message say what the server will actually do.

---

## B. Speed

Measured 2026-09-30 on production, Fast 4G + 4× CPU, 390×844: first paint
1.0s, `index.jsonl` request starts at 2.5s (after the whole module graph),
collections visible at ~4.1s. First visit ≈ 10 MB compressed. Warm loads with
the service worker are fast (DOMContentLoaded ~0.4s); in-app navigation is
120–145 ms per song; transposing is 17 ms. **The problem is the cold start and
the payload, not interactions.**

### B1 — Collection thumbnails · S

`jam_friendly.png` 2.5 MB (1234²), `fiddle_tunes.png` 1.3 MB, `billy.png`
654 KB, `Scruggs.webp` 469 KB (2171×2778), `bluegrass_dungeon.png` 407 KB —
all displayed at 80 px (`.collection-image`, `style.css:6948`), listed at
`main.js:566-573`, injected at `main.js:609` without `loading="lazy"`.
`renderCollectionCards()` runs inside `loadIndex` (`main.js:1389`) even for
deep links to a song, so those visitors download them into a hidden page.

- **Thumbnails** (`feature/perf-thumbnails`): 2× (160 px) WebP thumbnails
  next to the originals (keep originals), point the collection config at them,
  add `width`/`height`, `loading="lazy"`, `decoding="async"`.
- **Render gating** (`feature/perf-boot-data`): build the collection cards
  only when the home view is shown.

### B2 — Archive loads on every page · M

`main.js:1413` prefetches `data/archive.jsonl` (16 MB raw / 3 MB gzip, 16.6k
rows) when idle; Safari has no `requestIdleCallback`, so it fires on a 2s
timeout (`corpus.js:524-531`). Parse + merge ≈ 260 ms on an M-series Mac,
heap 12 → ~90 MB.

Load it only when needed: the Bluegrass Dungeon, an unknown id on a song page
(already awaited, `work-view.js:513-516`), list views with unresolved ids
(`lists.js:2179-2187` currently drops them silently), and any other resolver
that needs archived rows (grep `allSongs.find`, `ensureArchiveLoaded`). Make
sure a list that contains archived songs still shows them.

### B3 — First render waits on Supabase · M

`main.js:1357-1374` awaits the index, then awaits `fetchSupabaseOverlays()`
(`pending_songs select('*')`, `deleted_songs`, `promoted_songs`) before
rendering anything, with no timeout. `select('*')` ships every pending row's
full content (up to 200 KB per chart, 2 MB per tab) to every visitor.

Start the overlays in parallel with the index. Render the canon when the index
is in; race the overlays against ~800 ms; re-merge and refresh when they land.
Cache the last known deleted/promoted id sets in `localStorage` and apply them
immediately so a deleted song does not flash in. Select only the columns the
merge needs; fetch a pending row's content when that song is opened.
Add `<link rel="preconnect">` for the Supabase origin (in B4's head changes if
more convenient).

### B4 — Render-blocking third-party scripts · S

`index.html:30` loads supabase-js and `index.html:32` loads abcjs (500 KB raw /
148 KB gzip) synchronously in `<head>`; abcjs is only used for the ~160 songs
with ABC notation (`song-view.js:93`). `supabase-auth.js` is a classic script
(`index.html:777`).

`defer` supabase-js and `supabase-auth.js` (document order is preserved, and
module scripts run after deferred classic scripts); load abcjs on demand
inside the ABC render path; `preconnect` to `cdn.jsdelivr.net` and the
Supabase origin. Check every consumer of `window.supabase`,
`window.SupabaseAuth` and `ABCJS` still sees them when it runs.

### B5 — Theme flash; OS preference ignored · S

The saved theme is applied by `main.js:177-182`, after the whole module graph,
so dark-mode users get a white flash on every cold load. With no saved choice
the app ignores `prefers-color-scheme`, while `<meta name="theme-color">`
follows the OS, so the phone's chrome and the page disagree.

Inline a tiny script at the top of `<head>`: saved choice, else OS
preference, set `data-theme` before first paint. Keep `theme-color` in step
with the chosen theme (update it on toggle). The theme toggle keeps working.

### B6 — Legacy-ID map fetched for everyone · S

`cleanupLegacySongIds` (`lists.js:893-945`, called unconditionally from
`initLists`, `lists.js:3205`) downloads `legacy_id_mapping.json` (995 KB /
304 KB gzip) on every first visit, even with no lists;
`cleanLegacyIdsFromLists` (`lists.js:957-963`) downloads it again every
signed-in session. Fetch it only when a stored list contains an id that is not
already a known work slug.

### B7a — Route-specific modules loaded at boot · M

65 modules (1.47 MB raw / 419 KB gzip), 8 levels deep, no `modulepreload`;
41 of them (786 KB raw) are only needed on some routes:

- `otf-editor` facade/state/cursor/actions (231 KB) arrive through
  `tab-playback-interactions.js:16` (only for `positionFromSvgPoint`) and
  `otf-editor/create-tab.js:9`;
- the visual editor (111 KB), `editor.js`, `smart-paste`, `dedup-check` via
  `main.js:57`;
- `renderers/tablature.js` + `tab-player.js` (141 KB) via `work-view`;
- `review-queue.js` via `work-view.js:26`; `bounty-view`, `my-submissions`,
  `high-scores`, `drafts-view`, `zip`, `list-export` statically from
  `main.js`.

Load these with `import()` when their route or action runs; move
`positionFromSvgPoint` to `renderers/`; add `<link rel="modulepreload">` for
the core boot modules to flatten the waterfall. (The existing
`import('./lists.js')` calls in `search-core.js:1431/1455` gain nothing while
`main.js:46` imports it statically.) Keep behaviour identical; unit tests must
still import what they import.

### B7b — Service worker, prefetch, double renders · M

- Service worker: shell (HTML/JS/CSS) is network-first with no timeout
  (`sw-strategy.js:125`, `sw.js:84-103`); `data/songs/*.pro` falls into
  network-first too (`sw-strategy.js:118-122`). Use stale-while-revalidate
  for the shell (the "Updated — reload" toast in `pwa.js` already exists) or
  network-first with a ~1.5s timeout; put `.pro` under stale-while-revalidate;
  enable navigation preload. Bump the cache version correctly.
- Prefetch `data/songs/{id}.pro` on `pointerdown`/hover of a result and for
  the next song in a list.
- Lead sheet renders at least twice per open: `setCurrentDetectedKey` notifies
  even when unchanged (`state.js:270`) and the subscriber re-renders
  (`work-view.js:1545-1553`); make unchanged sets a no-op.
  `markWrappedLines` (`song-view.js:67-80`) interleaves layout reads and
  writes — batch reads then writes.
- Back/forward fires both `popstate` and `hashchange` (`main.js:2867-2880`),
  running `openWork` twice — de-duplicate.
- Tab pages draw twice: `TabRenderer` re-renders when the Bravura font is
  ready even if it was already ready (`tablature.js:276-280`); Bravura is
  loaded from `@latest` (`tablature.js:773`) — pin a version. Tab JSON is
  fetched with `cache: 'no-cache'` (`work-view.js:338`) — let the service
  worker / HTTP cache do their job.

---

## C. Data layer

### C1 — List store rework · L

Today lists live in `localStorage` (`songbook-lists`) and sync by a full
"local wins" merge on auth events only (`supabase-auth.js:1097-1130`,
`lists.js:1860-1910`). Consequences, all confirmed in code:

- removals made on one device come back from another; cleared key/tempo/notes
  come back (`lists.js:1446-1451`, `clearSongMetadata` sends `{}` at `:1486`,
  RPC merges with `||`);
- reordering lists never syncs (`reorderList`, `lists.js:1171-1198`); undo is
  local-only and gets reverted;
- lists are matched by name (`lists.js:1947-1978`,
  `supabase-auth.js:652-682, 1097-1098`); deleted-name tombstones never expire
  (`lists.js:55-63`);
- errors are swallowed (`{error}` is never checked: `lists.js:772, 1245, 1293,
  1331, 1381, 1465, 1486`); position races on concurrent adds
  (`supabase-auth.js:690-715`);
- sign-out wipes unsynced edits (`lists.js:1923-1928`);
- no live updates: no realtime, no polling, no `visibilitychange`;
- base list tables have no `CREATE TABLE` in any migration.

Target: tables under migrations with `updated_at`, `deleted_at` (soft
delete), client-generated UUIDs for lists **and items**, fractional positions;
an IndexedDB store with change events so open views redraw; a persistent
outbox of idempotent ops flushed on each op and on `online`/`visibilitychange`
with backoff; delta pull (`changes_since`) on load/focus plus Realtime or a
60s poll while visible; last-write-wins per row; surfaced errors; a two-client
sync test harness. Supersedes the client-side legacy-id mapping and
`user_favorites` (migrate once on the server). This is issue #82.

### C2 — Song index freshness · M

A returning PWA visitor boots on the previous visit's `index.jsonl`
(stale-while-revalidate, `sw-strategy.js:118-120`), while `cleanup-pending`
has already deleted the committed pending rows
(`supabase/functions/cleanup-pending/index.ts:36-44`), so newly published songs
show "Song not found" for that visit. Emit `data/version.json` (build sha) at
build time; record the sha on pending rows; drop an overlay row only once the
loaded index is at least that build; have the service worker tell the page
when a revalidated data file changed so it re-merges in place.

---

## D. Library building blocks (on C1)

Principle (Mike, 2026-09-30): **build the bones, not the use cases.** Generic
pieces users combine however they like; typed fields only where the app acts
on them.

- **D1 Folders** — synced, nestable; placement is per user (a shared band list
  can sit in each member's own folder), stored as a user→list→folder link, not
  a column on the shared list. The existing local-only folder code
  (`lists.js:459-590`, no creation UI) is the starting point.
- **D2 Items** — each item has its own id and is either a song reference
  (work, version or tab part) or a **divider** ("Set 1", "Week 2 goals"); the
  same song may appear twice.
- **D3 Notes** — Markdown (small in-house subset: bold, italic, lists,
  checkboxes, links; never raw HTML) on folders, lists and items, shown beside
  the chart (desktop side panel, phone pinned card). A pasted YouTube or Strum
  Machine link renders as a button. Optional: a private per-user song note.
- **D4 Overrides** — key, capo, tempo on an item, applied everywhere: song
  page, print, export, followers.
- **D5 Sharing** — "Shared with me / Following" shelf (`getFollowedLists`,
  `lists.js:2071`, has no caller), Leave (`leaveList` has no UI), a co-owner
  delete that no longer deletes the list for everyone.
- **D6 Play-through** — multi-version songs show "0 of N"
  (`search-core.js:1328-1331`, `work-view.js:664`); tab items lose list context
  (`search-core.js:1327`); "☰ List" is `history.back()` (`main.js:2953`); list
  views push history on every render (`lists.js:2086-2132`).
- **D7 Printable songbook** — setlist keys/notes applied
  (`main.js:2257` ignores them), table of contents, page breaks, no popup
  opened after awaits (Safari blocks it, `main.js:2162-2166`), export works
  for followed/shared lists (`main.js:2124-2131`).

## E. Editors

- **E1 One ChordPro core** — one parse/serialise/validate module used by the
  renderer, both editor panes and the duplicate check; one chord regex
  (today: `chords.js:120`, `smart-paste.js:17/41/432`; smart-paste turns Dsus4
  into Dsus and A6 into A); chords-only lines for instrumental breaks; sections
  added from the visual pane.
- **E2 Drafts + unsaved guard** — one draft store (IndexedDB `drafts.js`) and
  one `canLeave()` guard for both editors; drafts keyed by (work, take/part);
  "Resume unsaved edits?" when reopening; flush on `pagehide`. Covers #267.
- **E3 Lead-sheet editor** — visual pane first on phones
  (`style.css:9170-9176`); no mid-word gaps where a chord chip is wider than
  its syllable ("go ne", "shi ning"); keyboard chord entry (arrows between
  slots, Up/Down between lines, Nashville digits); one undo stack.
- **E4 Tab editor traps** — Import .tef is undoable and confirms over unsaved
  edits (`work-view.js:2780-2789`, `facade.js:234-245`); "Done" becomes
  "Close" plus an "Unsubmitted changes" marker (`work-view.js:2821-2844`);
  fast digits stop merging into two-digit frets when the cursor has advanced
  (`keyboard.js` `REFINE_MS`, `bindings.js:560-580`); stale shortcut tooltip
  (`editor.js:1609`).
- **E5 Tab editor on touch** — docked fret pad (tap string, tap fret, advance),
  single tap edits a note, pointer events for selection
  (`editor.js:744, 783-785`).
- **E6 Tab editor speed** — every keystroke deep-copies the document twice
  (`facade.js:24, 468-494`) and redraws every row (`tablature.js:578-637`);
  redraw only changed measures, diff-based undo, a performance test on
  `works/orange-blossom-special/ensemble.otf.json` (1.8 MB, 356 measures).

## F. Visual design

Rule: **hide setup, show content and resources.**

- **F1 Foundation** — tokens for type scale, spacing, radius, shadow,
  z-index, motion; delete the ~13% of `style.css` no code references (sidebar
  lists 4506–4715, old quick-controls 1926–2178, list-card menus 8697–9034, …);
  split into files with cascade layers (`@layer legacy` first, migrate out);
  one breakpoint set shared with JS (today 600/640/700/720); fix the stale
  print block (7364–7481).
- **F2 Components** — one `.btn` (73 button classes today), one chip (search
  shows four styles in one row), one segmented control, one menu/sheet
  pattern, one focus ring; one icon set instead of mixed emoji.
- **F3 Fewer boxes** — drop the page card; the song is the page; hairlines and
  spacing instead of nested borders.
- **F4 Disclosure** — tab page header in one line
  (`Banjo · Scruggs style (8) ▾ · Track: banjo ▾`) instead of five rows;
  bottom band shows only what you touch while playing, setup in one sheet;
  sensible default part (Foggy Mountain Breakdown opens on a mandolin break).
- **F5 Reading layout** — no mid-word wrapping on phones ("proved un / D /
  true"); columns on wide screens (a song uses a third of a desktop screen);
  chords that don't look like links; one monospace stack if monospace stays.
- **F6 Direction** — mockups of two visual directions for the song page, tab
  page and library before committing to F3–F5.
