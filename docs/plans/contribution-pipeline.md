# Plan: Contribution pipeline — latency, identity, and dedup-on-add

**Status:** ready to build. Written 2026-08-15 on `feature/promote-workflow`,
specifically so the build can start from a fresh context.

**How to use this doc:** it is self-contained. You should not need to re-derive
anything below — every claim was verified in-session against this worktree and
the file/line anchors are real. Start at [Step 1](#step-1--cleanup-pending-grace-window).

**Read this first:** the plan we walked in with was wrong in two places. The
agreed promote fix (a Supabase Edge Function firing `workflow_dispatch`) is
**not needed** — see [Correction 1](#correction-1-promote-needs-no-edge-function).
And the "let trusted users add songs directly" feature **already ships** — see
[Correction 2](#correction-2-trusted-user-direct-add-already-ships). Both
corrections shrink the work substantially.

---

## The goal, in Mike's words

> "I actually think we just drop all write / suggest support for anyone that
> isn't logged in (besides bug reports)."

> "A user adds a song, and people in a jam are playing it together. It should
> be fast."

> "Let's say a user just thinks 'I'm going to add Will the Circle Be Unbroken.'
> Then they go add it. But that song is in the index. And we need a mechanism
> to show them 'hey by the way, I think we have that song.' It should trigger
> by title, and by lyrics."

> "We're capping out on programmatically adding stuff to the index and need to
> start focusing more on a high quality manual addition process."

> "The hourly sync thing feels like it could just be an instant write to
> supabase. Github would then be a backup, essentially."

This last one is a restatement of a principle already recorded in
`docs/plans/tab-authoring.md` (2026-08-02):

> **Supabase is for latency, not isolation.** He wants uploads to appear
> immediately; git can catch up asynchronously.

That principle is correct and this plan follows it. See
[The tier model](#the-tier-model) for the precise version, including the one
place "git is just a backup" overshoots.

---

## The tier model

Every change below is an application of one model and one invariant.

| Tier | Store | Latency | Authoritative for |
|------|-------|---------|-------------------|
| **1. Live** | Supabase tables, world-readable, merged client-side | seconds | writes in flight; curation decisions |
| **2. Durable** | `works/` + tracked caches in git | minutes | the corpus |
| **3. Reconcile** | sync workflow, `cleanup-pending`, retry pass | minutes–hourly | making 1 and 2 agree |

**The invariant:**

> Tier 3 must never remove something from tier 1 until it can prove tier 2 is
> serving it.

`cleanup-pending` violates this today. That is [Step 1](#step-1--cleanup-pending-grace-window)
and it is the single worst live bug in the system.

### Where "git is just a backup" overshoots

Do **not** migrate the corpus into Supabase. There are 19,227 works, and
`works/*/work.yaml` is where curation actually happens — grep, diff, hand-edit,
review a PR. The root `CLAUDE.md` pins this deliberately as of 2026-07-31
("Metadata fixes belong DIRECTLY in `works/*/work.yaml`"). Trading that for a
database you would then have to build an admin UI for is a large loss to buy
latency you already have.

The formulation that gets everything Mike asked for without the migration:

> **Supabase is authoritative for writes in flight and for decisions.
> Git is authoritative for the corpus.**

But the instinct behind "git is a backup" does bite in one real place, and it
is [Step 5](#step-5--make-the-reconciler-real): if git is the durable side, the
path to it must actually be reliable. Today it is
`.catch(e => console.warn(...))`.

---

## Corrections to the walk-in plan

### Correction 1: promote needs no edge function

`promoted_songs` is **already world-readable**:

```sql
-- supabase/migrations/20260814000000_promote_songs.sql
create policy "Anyone can read promoted songs" on promoted_songs
  for select using (true);
```

The frontend simply never reads it. `docs/js/supabase-auth.js:257,285` call the
`promote_song` / `unpromote_song` RPCs and stop there;
`docs/js/main.js:1431` explicitly defers to "the hourly sync + rebuild."

Meanwhile `pending_songs` — same `select using (true)` policy — **is** read, at
`docs/js/main.js:1196-1204`, unfiltered (`select('*')`) and unauthenticated, on
every page load.

So the mechanism for instant, everyone-sees-it propagation already exists,
is already proven in production, and promote just isn't plugged into it.

**Consequence:** the agreed edge-function-plus-`workflow_dispatch` design is
cancelled. It would have delivered ~5 minutes; a client-side overlay delivers
**zero**, in roughly 15 lines, with no new function to deploy, no PAT scoped to
`actions:write`, no dispatch debouncing, and no exposure to the
concurrency-group eviction trap documented in
`.github/workflows/process-song-submission.yml`.

### Correction 2: trusted-user direct add already ships

`docs/js/editor.js:830` branches on trusted status:

- **trusted** → upsert `pending_songs` (`editor.js:906`, instant visibility via
  the overlay) → fire `auto-commit-song` (`editor.js:960`), which re-verifies
  `trusted_users` server-side and PUTs `works/{slug}/work.yaml` +
  `lead-sheet.pro` straight to `main` via the GitHub Contents API.
- **everyone else** → `create-song-issue` (`editor.js:1012`) → GitHub issue →
  manual `approved` label → `process-song-submission.yml`.

24 works currently carry `source: trusted-user`. The feature is live.

**Consequence:** "let trusted users add songs directly" is not a build. The real
problem is that the direct path is not *safe* — see
[Step 6](#step-6--harden-the-single-writer).

### Correction 3: the phone→computer scenario is already handled for logged-in users

Because the `pending_songs` overlay is world-readable and fetched on every page
load regardless of auth, a trusted user's add is visible on their laptop, and to
everyone else at the jam, within seconds. Login is not what buys continuity.

What login buys is **the ability to be in tier 1 at all**. An anonymous
submission goes to a GitHub issue and is invisible on every surface the
submitter can see, on every device, until someone labels it. That is the real
argument for requiring login — not sync, but the fact that the anonymous path
has no feedback surface by construction.

### Correction 4: Will the Circle Be Unbroken is indexed, not archived

Both `works/will-the-circle-be-unbroken` (artist: Eddy Arnold) and
`works/will-the-circle-be-unbroken-1` (artist: George Jones) exist, and neither
appears in `curation/index_prune.csv`. Both are searchable today.

So Mike's example resolves to **"add as an arrangement,"** not "promote." It is
a better example for it: the corpus *already contains* the duplicate pair that
dedup-on-add exists to prevent. (Both artist values are scrape artifacts — the
`artist` field means "as performed by," per root `CLAUDE.md`.)

---

## Verified current state

Anchors below were all checked in-session.

### Edge functions — no deploy pipeline

`supabase/functions/` holds seven functions: `auto-commit-song`,
`cleanup-pending`, `create-flag-issue`, `create-song-issue`,
`create-song-request`, `create-superuser-request`, `create-tab-pr`.

`grep -rn "supabase/functions" .github/` returns **nothing**. Every function is
hand-deployed. Production is whatever was last pushed from someone's laptop and
the repo has no way to signal drift.

This is the confirmed cause of the missing attribution: `create-song-issue/index.ts:66,89`
renders `**Submitted by:** ${attribution}`, but per Mike none of the 25 lifetime
issues contain that line. **The code is correct; the deployment is stale.**

### The cleanup race

```ts
// supabase/functions/cleanup-pending/index.ts
.from('pending_songs').delete().eq('github_committed', true)
```

Unconditional on the flag. And `auto-commit-song` sets `github_committed = true`
immediately after the Contents API PUT returns — *before CI has started*.

```yaml
# .github/workflows/cleanup-pending.yml
on:
  workflow_run:
    workflows: ["CI & Deploy"]
    types: [completed]
    branches: [main]
```

Fires on **any** successful CI & Deploy run on main. So: add a song at a jam;
twenty seconds later the hourly sync workflow's own commit finishes deploying;
cleanup fires and deletes the row; the song's own deploy is still running. The
song vanishes from every phone in the circle for several minutes, then returns.

This hits trusted, logged-in users. Nothing about it is anonymous-related.

### Two divergent writers to `works/`

| | `scripts/lib/process_submission.py` (CI) | `supabase/functions/auto-commit-song` (edge) |
|---|---|---|
| YAML generation | `yaml.dump` | string concatenation |
| composers | list via dumper | `` `[${entry.composer}]` `` — **unquoted** |
| slug collision | suffix loop `-1`, `-2` (`:181-188`) | none — sends existing sha, **overwrites** |
| suppressed/deleted check | `is_suppressed(slug, registry, deleted_songs)` | none |
| provenance source | `manual` | `trusted-user` / `user-submission` |
| tags | `[]` | `[]` |

A trusted user adding a title that already exists silently replaces the existing
work. A composer value of `Smith, John` becomes two composers; one containing a
colon produces YAML that CI then fails to parse.

Note `USER_SOURCES = {'manual', 'trusted-user', 'pending'}` in
`scripts/lib/curation.py:288` does **not** include `user-submission` (written by
`buildPlaceholderWorkYaml` for doc uploads). Low impact today — the prune only
applies to ids on `curation/index_prune.csv` (17,089 rows, all pre-existing), so
a brand-new work is never pruned regardless — but it is a latent inconsistency
to fix while touching this code.

### Dedup machinery already exists

`scripts/lib/build_works_index.py`:

- `compute_group_id(title, artist, lyrics)` (`:160`) → `{title_artist_hash}_{lyrics_hash}`,
  where the lyrics half is `md5(normalize_lyrics(lyrics)[:200])[:8]` (`:211-212`).
  Assigned to every row at `:493`.
- `fuzzy_group_songs` (`:570`) merges group_ids across spelling variants,
  requiring **both** title and lyrics similarity. Its docstring records the
  hard-won false positives: "I Walk Alone" vs "I Walk The Line", "Good Hearted
  Woman" vs "Good Hearted Man", "Still Loving You" vs "Still Losing You".

And the inputs already ship to the browser:

- index rows carry `first_line` (`:467`), `lyrics[:500]` (`:468`), `group_id`
- archive rows carry the same with `lyrics` clipped to
  `ARCHIVE_LYRICS_CHARS = 200` (`:299`, applied `:349`)

**200 is exactly the window `compute_group_id` hashes.** So the browser can
recompute the identical fingerprint for all 19,227 works — canon and archive
alike — from data it has already downloaded. No API, no new artifact, and no
split-brain between what the client warns about and what the build groups.

---

## The changes

Sequenced so Steps 1–2 ship same-day and are independent of every open
question. Each step is its own PR.

### Step 1 — `cleanup-pending` grace window

**Problem:** the tier invariant violation above. Songs vanish mid-jam.

**Fix (cheap version):** add an age guard so a row cannot be reaped before its
own deploy has plausibly landed.

```ts
.from('pending_songs')
.delete()
.eq('github_committed', true)
.lt('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
```

**Fix (correct version, if Step 5 lands):** record the commit sha on the
`pending_songs` row at PUT time, pass `github.event.workflow_run.head_sha` into
the cleanup call, and delete only rows whose sha is an ancestor of the deployed
sha. Requires a migration (`commit_sha text`) and a signature change.

**Recommendation:** ship the cheap version now, the correct version with Step 5.
The cheap version is one line and removes the user-visible bug immediately.

**Files:** `supabase/functions/cleanup-pending/index.ts`
**Test:** insert a row with `github_committed = true, created_at = now()`, invoke,
assert it survives; backdate 20 minutes, invoke, assert it is deleted.
**Risk:** none — strictly delays deletion.
**Blocked on:** Step 3 (nothing deploys edge functions today).

### Step 2 — overlay `promoted_songs` and `deleted_songs` client-side

**Problem:** promote and admin-delete take up to an hour to reach other
visitors. Promote is optimistic in the promoting user's session only.

**Fix:** fetch both tables alongside `pending_songs` in `main.js`, and apply
them in `rebuildCorpus()`:

- `promoted_songs` → set `indexed = true` on matching archive rows
- `deleted_songs` → drop matching rows entirely

Follow the existing `pending_songs` pattern exactly (`main.js:1196-1204` for the
load path, `:1253 refreshPendingSongs` for the post-action refresh, graceful
degradation on error so the static index still works offline). Add a
`refreshPromotedSongs` sibling and call it from `supabase-auth.js:257,285` after
the RPCs return, so the promoting user's own session updates without a reload.

Then update the stale comment at `main.js:1431`.

**Effect:** promote-to-live-for-everyone goes from ~1 hour to **zero**. The
hourly sync workflow stops being the delivery mechanism and becomes pure
durability — which is what it should always have been, and is exactly Mike's
"instant write to Supabase, GitHub as backup" applied where it actually fits.

**Files:** `docs/js/main.js`, `docs/js/corpus.js`, `docs/js/supabase-auth.js`
**Test:** vitest over `rebuildCorpus` with synthetic overlay rows — promoted
archive row becomes `indexed: true`; deleted row disappears; deleted-and-promoted
row disappears (deletion wins, matching the build-time precedence in
`apply_index_prune`).
**Risk:** low. Overlay is additive and already degrades gracefully.
**Blocked on:** nothing. Ship first.

> **Keep the hourly sync.** It is now durability rather than delivery, but it is
> what puts the decision into `works/`-adjacent tracked caches so the built index
> is correct for users who load before the overlay resolves, and for anyone with
> JS disabled or Supabase unreachable.

### Step 3 — `deploy-functions.yml`

**Problem:** production edge functions drift from the repo with no signal. This
is why attribution is missing. It also blocks Steps 1, 5, and 6, all of which
change edge function code.

**Fix:** a workflow on push to `main` touching `supabase/functions/**` that runs
`supabase functions deploy` with a project ref and access token from secrets.
Deploy all functions, or matrix over changed directories.

**Files:** `.github/workflows/deploy-functions.yml`
**Secrets needed:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`
**Test:** deploy once, then confirm a new `create-song-issue` submission renders
the `**Submitted by:**` line. That single observation validates the whole step.
**Risk:** medium — first run will deploy seven functions whose current prod
state is unknown. Diff each against prod before merging, or deploy them one at a
time manually first and let CI take over from a known-good baseline.

### Step 4 — require login for writes

**Decision (Mike, this session):** anonymous users can **report**, not **write**.

| Stays anonymous | Requires login |
|---|---|
| `create-flag-issue` (something's wrong with this song) | `create-song-issue` |
| `create-song-request` (please add this song) | `auto-commit-song` |
| | doc upload (`doc-upload.js`) |
| | tab submission (`otf-editor/submit-tab.js`) |

The dividing line: anything that produces something the user will later look for
requires an identity to show it back to. A confirmation toast is a complete
experience for a report; it is not for a contribution.

**Fix:**
- Editor requires a session before submit; replace the anonymous branch with a
  sign-in prompt.
- `create-song-issue` rejects unauthenticated calls (verify the JWT the way
  `auto-commit-song` already does — `getUser(token)` against the service client).
- Delete `getSubmitterAttribution()` and every "Rando Calrissian" fallback.
  Attribution comes from the verified session server-side, never from a
  client-supplied `submittedBy` field.

**Files:** `docs/js/editor.js`, `docs/js/flags.js:232`,
`docs/js/otf-editor/submit-tab.js:37,64`, `docs/js/doc-upload.js:491`,
`docs/js/work-view.js:1586-1599`, `supabase/functions/create-song-issue/index.ts`
**Test to update:** `docs/js/__tests__/otf-editor/submit-tab.test.js:52` asserts
`body.submittedBy === 'Rando Calrissian'`. It should become an assertion that an
unauthenticated submit is refused.
**Docs to update:** `docs/js/CLAUDE.md:669,701` describe the Rando fallback.

> **This deletes the attribution bug rather than fixing it.** No need to ship a
> corrected `submittedBy` through a pipeline whose anonymous branch is being
> removed. Step 3 still matters for the other six functions.

**Consequence to plan for:** if untrusted-but-logged-in users are eventually
allowed to write to `pending_songs`, the RLS insert policy (trusted-only today)
opens up, and the overlay becomes world-readable content any account can write.
That wants a per-user rate limit in the RPC and a delete-own policy. Login is
what makes both possible — an argument for this step, not against it. Not needed
on day one at 25 lifetime submissions.

### Step 5 — make the reconciler real

**Problem:** `editor.js:916` fires the commit as
`triggerAutoCommit(...).catch(e => console.warn(...))`. A failed commit leaves a
`pending_songs` row with `github_committed = false` that nothing retries and
nobody is told about. The song stays live off the overlay indefinitely and never
enters the corpus. That is not a backup — it is an unmonitored queue.

**Fix:**
1. **Measure first.** Query `pending_songs where github_committed = false`. That
   count is the current drift. Do this before writing any code; it sizes the
   problem and may surface songs that need manual rescue.
2. Retry pass: extend the sync workflow (or add a scheduled function) to re-drive
   uncommitted rows through the commit path.
3. Alert when a row ages past a threshold without committing.
4. Record `commit_sha` on the row at PUT time, enabling Step 1's correct version.

**Files:** `supabase/functions/auto-commit-song/index.ts`, new migration,
`.github/workflows/sync-deleted-songs.yml` (or a new reconcile workflow)
**Risk:** low, additive.

### Step 6 — harden the single writer

**Problem:** the divergent-writers table above. Overwrites, YAML injection, no
suppression check.

**Fix, preferred:** stop authoring YAML in TypeScript. Reduce `auto-commit-song`
to enqueue + dispatch, and let `process_submission.py` — which already has
collision handling, suppression checks, and `yaml.dump` — be the only writer to
`works/`. This deletes `buildWorkYaml`, `buildPlaceholderWorkYaml`, and
`appendDocumentPart`: three schema implementations that will otherwise drift from
`work_schema.py` forever.

**Fix, minimal:** if keeping the edge function as a writer, port the three
missing behaviours into it — quote `composers` properly, add the collision
suffix loop, add the suppressed/deleted check — and add a test asserting parity
with `process_submission.py` output for the same input.

**Recommendation:** preferred version. It is more work up front and removes an
entire class of future bug. It also means dispatch-from-edge-function gets built
once, here, where it is actually load-bearing — rather than in Step 2, where
Correction 1 showed it was not needed.

**Also fix here:** add `user-submission` to `USER_SOURCES` in
`scripts/lib/curation.py:288`, or normalize the edge function to emit
`trusted-user` for both paths.

### Step 7 — dedup-on-add

**Problem:** a user transcribes a song that already exists. Nothing tells them
until a human notices, if ever. `will-the-circle-be-unbroken` /
`will-the-circle-be-unbroken-1`, and `how-long-blues` / `how-long-blues-1`
(issue #208, 2026-08-15) are the corpus's own evidence.

> **#208 is the motivating case.** `works/how-long-blues` was a
> BluegrassLyrics scrape from Feb 2026: lyrics, no chords, no artist, no
> composer. Issue #208 supplied the same song with chords (E/E7/A/B), artist
> (Del McCoury), and a composer meta. The pipeline created a **second work**
> rather than enriching the first, because nothing checks incoming submissions
> against the corpus. It came through the *reviewed* path, with a human
> approving it — so the duplicate would have been created regardless of the
> login gate. **Programmatic dedup is the valuable half of the tiered design,
> independent of the A/B question.**

#### The existing detector would NOT have caught it

`scripts/lib/dedup_works.py` exists and looks like the right tool — it scores
title/artist/lyrics/key and emits a merge plan that `scripts/lib/merge_works.py`
can execute (including `redirects.json`). **Do not assume it works for this.**
Measured on the two `how-long-blues` works from `origin/main`:

| metric | score |
|---|---|
| `dedup_works.py` as written (300-char window, `SequenceMatcher`) | **0.043** — threshold is 0.5, so a **miss** |
| full text, `SequenceMatcher` | 0.188 |
| full text, Jaccard over word sets | 0.646 |
| full text, **containment** (∩ / smaller side) | **0.886** |

Two independent defects, and fixing only one is not enough:

1. **`normalize_lyrics` (`dedup_works.py:71`) truncates to the first 300 chars.**
   The existing work opens with a verse; #208 opens with the chorus. The
   windows barely overlap.
2. **`similarity()` is `SequenceMatcher` — order-sensitive.** Removing the
   window alone only reaches 0.188, still a miss.

**Use containment, not Jaccard, as the primary signal.** A lyrics-only work is
close to a *subset* of a fuller submission; Jaccard penalizes the size
difference, containment does not. **High containment + large size delta is the
signature of enrichment** — as distinct from "same song twice," which shows high
containment *and* similar size. That distinction is what routes to the right
outcome in the table below.

`build_works_index.py:600-607` already has a Jaccard word-overlap helper used by
`fuzzy_group_songs`. The better primitive exists in the repo; it just is not the
one `dedup_works.py` reaches for.

**Fix:** repair the scoring in `dedup_works.py` (full-lyric, order-insensitive,
containment-primary), then port those normalizers to JS for the editor and run
them against the already-loaded corpus. Fixing the Python first means the client
and the batch tool agree by construction.

**Two insertion points, and the CI-side one is higher value:**

- **CI side** — `process_submission.py`, before creating a new slug. Catches
  everything, including human-approved submissions. This is the one that would
  have stopped #208.
- **Client side** — the editor, before the user transcribes a whole chart. Better
  UX, but bypassable and only helps users of the editor.

Build the CI-side check first.

**Match against:** the index, the archive (`loadArchive()`), **and** the
`pending_songs` overlay — otherwise two people at the same jam add the same song
ninety seconds apart.

**When to check:**
- **On title entry**, against `title` + `first_line`. Free — the corpus is in
  memory. This is where the friction actually is: catching it here saves the
  user from transcribing a whole chart.
- **On ChordPro paste**, again with real lyrics, using `compute_group_id`
  parity.

**Four outcomes, not one warning:**

| Match | Offer |
|---|---|
| high containment, **incoming is richer** (adds chords/artist/composer to a sparser work) | **Enrich the existing work** — add the part, do not create a slug. This is the #208 case. |
| archived work | **Promote it** — one click, instant via Step 2 |
| indexed work, comparable richness, different chart | **Add as an arrangement** — routes into existing version/arrangement grouping |
| no match, or user overrides | **Add as new** |

The enrichment row is the one the current pipeline gets wrong, and it is the
safest of the four to automate: adding chords to a lyrics-only work destroys
nothing. That is the "gate on what the change does, not who submitted it"
principle from the original design discussion, in its narrowest and most
defensible form — worth applying regardless of how the login question lands.

**The override must be one click.** "Will the Circle Be Unbroken" covers two
genuinely distinct songs — the 1907 Habershon/Gabriel hymn and the Carter
Family's 1935 rewrite — plus many legitimate arrangements. A blocking warning
would be wrong roughly as often as it is right.

**Log every override** to `submission_log` (`action: 'dedup_override'`, metadata
carrying the matched id and the similarity score). "User overrode a
high-confidence match" is the best threshold-tuning signal available and costs
one row.

**Files:** `scripts/lib/dedup_works.py` (scoring fix),
`scripts/lib/process_submission.py` (CI-side check), new `docs/js/dedup.js`
wired into `docs/js/editor.js` and `docs/js/add-song-picker.js`

**Tests:**
- **Regression fixture from #208.** `works/how-long-blues` vs
  `works/how-long-blues-1` must score as a match. It scores 0.043 today. This
  pair is the single best test case in the corpus — it is a real miss, from the
  real pipeline, with a known-correct answer.
- Negative fixtures from `fuzzy_group_songs`'s docstring, which records the
  hard-won false positives: "I Walk Alone" vs "I Walk The Line", "Good Hearted
  Woman" vs "Good Hearted Man", "Still Loving You" vs "Still Losing You". A
  containment-based scorer is *more* prone to these than a sequence-based one,
  so they must stay below threshold.
- Golden vectors for the JS port — run the Python normalizers over a fixture
  set, commit the outputs, assert the JS matches byte-for-byte. Same pattern as
  the TEF parser JS port. Essential: if the two drift, the client warns about
  things the batch tool does not group, and vice versa.

**Risk:** medium on the CI side (a false positive silently folds a distinct song
into the wrong work — mitigated by the negative fixtures, and by making
enrichment additive-only so nothing is overwritten). Low on the client side,
which is purely advisory.

### Step 8 — fix composer extraction

**Problem:** `scripts/lib/process_submission.py:126` requires a colon *after*
`composer`:

```python
re.search(r'\{(?:composer|meta:\s*composer):\s*(.+?)\}', content, re.IGNORECASE)
```

Measured behaviour:

```
{composer: Leroy Carr}        -> 'Leroy Carr'
{meta: composer: Leroy Carr}  -> 'Leroy Carr'
{meta: composer Leroy Carr}   -> None      <- the form root CLAUDE.md documents
```

So the project's own documented `{meta: key value}` convention is the one form
that fails. `works/how-long-blues-1/work.yaml` has **no `composers` field**
despite its lead sheet declaring `{meta: composer Leroy Carr}`. Since the
index's `composer` comes only from `work.yaml` `composers` (root `CLAUDE.md`),
Leroy Carr is invisible to search.

This has presumably been dropping composers from every submission using the
documented syntax. Independent of everything else in this plan.

**Fix:** make the colon after the key optional, and audit the sibling
extractors (`extract_key_from_chordpro`, and the equivalents in
`process_correction.py`) for the same shape.
**Test:** all three forms above, plus the bare `{meta: composer X}` form as a
regression fixture.
**Risk:** none. Strictly widens what is recognized.
**Backfill:** worth a one-off sweep for works whose `.pro` declares a composer
their `work.yaml` lacks.

---

## Sequencing summary

| Step | Ship | Depends on | Effort |
|------|------|-----------|--------|
| 2. Promote/delete overlay | **first, same day** | nothing | ~15 lines + tests |
| 3. `deploy-functions.yml` | next | secrets | small, some prod risk |
| 1. Cleanup grace window | with/after 3 | 3 | one line |
| 4. Require login | after 3 | 3 | medium; touches 6 files + tests + docs |
| 5. Real reconciler | after 4 | 3, 4 | medium; **measure first** |
| 6. Single writer | after 5 | 3, 5 | largest |
| 7. Dedup-on-add | independent | 2 (for the promote affordance) | medium |
| 8. Composer extraction | anytime | nothing | trivial |

Steps 2 and 7 deliver everything Mike named as the user-visible goal — instant
propagation at the jam, and "hey, I think we have that song." Neither depends on
the login decision. Steps 1, 3, 5, 6 are the correctness debt underneath, and
would be worth doing even if the contribution model never changed. Step 8 is a
one-line bug found while investigating #208.

**#208 is the argument for prioritising Step 7 over the login work.** The
duplicate came through the reviewed path with a human approving it. No gate —
neither Option A nor Option B — would have prevented it. Dedup would have.

---

## Pending decision: merge `how-long-blues` / `how-long-blues-1`

Authoritative data, so it is Mike's call and nothing has been touched. Facts,
all verified against `origin/main`:

| | `how-long-blues` (Feb 2026) | `how-long-blues-1` (#208) |
|---|---|---|
| Chords | none — 0 bracket tokens | E / E7 / A / B |
| Artist | absent | Del McCoury |
| Composer | absent | **absent in `work.yaml`** (declared in `.pro`, dropped by the Step 8 bug) |
| Sections | 4 | 6 |
| Source | `bluegrass-lyrics` scrape | `manual`, issue #208 |

**`-1` does not strictly dominate.** The original has a closing verse `-1` lacks:

> Cruel engineer can't you see / I need my baby back with me / Then I'd be rid
> of these mean ol' lonesome blues

13 words appear only in the original, and that verse is most of them.

**Recommendation:** keep `how-long-blues-1` as canonical, but first (a) port the
missing verse across, and (b) add `composers: [Leroy Carr]` by hand, since
Step 8's bug dropped it. Then suppress the original with a redirect —
`merge_works.py` already handles the redirect side.

---

## Open questions

1. **Untrusted-but-logged-in writes.** Step 4 makes login mandatory but does not
   decide whether a non-trusted logged-in user's submission auto-commits or
   queues for review. Deliberately deferred: once Step 6 exists, "is this change
   additive and non-destructive?" becomes a computable signal, and login becomes
   one input to a threshold rather than the gate itself. Decide then, with data.
2. **Whether to keep `create-song-issue` at all.** If every writer is logged in
   and lands in `pending_songs`, the GitHub-issue path may be redundant with a
   moderation queue built on the table. Not decided here.
3. **#207 (pending submissions visible across devices).** Falls out of Step 4 for
   free — with a mandatory session, `pending_songs.created_by` is always
   populated and can be filtered per user.
4. **Rate limiting.** Not needed at 25 lifetime submissions. Revisit if Step 4's
   RLS opens `pending_songs` inserts beyond trusted users.
