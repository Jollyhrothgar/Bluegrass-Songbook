# Plan: Contribution pipeline

**Status:** ready to build. Written 2026-08-15 on `feature/promote-workflow`.

Decisions are in the first two pages. [Appendix](#appendix--verification) has the
file anchors and measurements behind them — you should not need to read it.

---

## The one idea

Three tiers, one rule.

| Tier | Where | Speed | Owns |
|---|---|---|---|
| **Live** | Supabase, world-readable, merged in the browser | seconds | writes in flight, curation decisions |
| **Durable** | `works/` in git | minutes | the corpus |
| **Reconcile** | sync workflow, cleanup | minutes | making the two agree |

> **The rule:** reconcile must never remove something from Live until Durable is
> actually serving it.

`cleanup-pending` breaks this today, which is why songs can vanish mid-jam.
That's Step 1.

**Supabase is for latency, git is for the corpus.** Don't migrate 19,227 works
into a database you'd then need an admin UI for — `works/*.yaml` is where you
actually curate, by grep and diff.

---

## What we got wrong walking in

Three things turned out to be false. Each one shrinks the work.

1. **Promote doesn't need an edge function.** `promoted_songs` is already
   world-readable — the frontend just never reads it. A client-side overlay
   gets **zero** latency in ~15 lines. The agreed edge-function + `workflow_dispatch`
   design is cancelled.
2. **Trusted-user direct add already ships.** `auto-commit-song` commits to
   `works/` today; 24 works came in that way. The problem isn't that the path
   doesn't exist, it's that it isn't safe.
3. **`dedup_works.py` would not have caught #208.** It scores that pair 0.043
   against a 0.5 threshold — a clean miss, not a near miss. Building on "just run
   the existing detector" would have shipped a check that misses the exact case
   that motivated it.

---

## Steps

Ordered by ship order. Steps 1–2 are same-day and depend on nothing.

### 1. Stop songs vanishing mid-jam

`cleanup-pending` deletes pending rows on *any* successful deploy, but
`auto-commit-song` marks a song committed before CI even starts. So an unrelated
deploy lands, the row is deleted, and the song disappears from every phone in the
circle until its own deploy finishes.

**Fix:** don't reap rows younger than 15 minutes. One line.

### 2. Promote and delete go live instantly

Fetch `promoted_songs` and `deleted_songs` alongside `pending_songs` and apply
them client-side: promoted archive rows become visible, deleted rows disappear.

Promote goes from ~1 hour to zero. The hourly sync stops being the delivery
mechanism and becomes pure durability — keep it, it's what covers users who load
before the overlay resolves.

### 3. Deploy pipeline for edge functions

Nothing in `.github/` deploys `supabase/functions/`. All seven are hand-deployed,
and production is whatever someone last pushed from a laptop. This is why the
attribution line is missing from all 25 issues — the code is correct, the
deployment is stale.

Blocks Steps 1, 5, 6, which all change function code.

**Risk:** first run deploys seven functions whose current prod state is unknown.
Hand-deploy once to a known baseline, then let CI take over.

### 4. Login required to write

**Anonymous users can report, not write.**

- **Stays anonymous:** flag a problem, request a song. A confirmation toast is a
  complete experience.
- **Requires login:** song submission, corrections, doc upload, tab submission.
  Anything the user will later go looking for.

This **deletes** the attribution problem rather than fixing it — "Rando
Calrissian" and the client-supplied `submittedBy` field both go away, and
identity comes from the verified session instead.

Also worth knowing: the phone→laptop continuity gap you described is
anonymous-only. The `pending_songs` overlay already covers logged-in users on any
device. What login really buys is *the ability to be in the Live tier at all* —
an anonymous submission has no feedback surface anywhere, by construction.

### 5. Make the reconciler real

The commit is fire-and-forget (`.catch(console.warn)`). A failed commit leaves a
row nothing retries and nobody hears about — the song lives in Supabase forever
and never reaches the corpus. That's not a backup, it's an unmonitored queue.

Needs a retry pass and an alert. **Measure first:** count rows where
`github_committed = false`. That number is your current drift and may contain
songs needing manual rescue.

### 6. One writer for `works/`

Two things write works and they disagree. The edge function builds YAML by string
concatenation — no collision handling (it **overwrites** an existing work), no
suppression check, and `composers: [Smith, John]` unquoted becomes two composers.

**Fix:** stop authoring YAML in TypeScript. Reduce the edge function to enqueue +
dispatch and let `process_submission.py` — which already handles collisions,
suppression, and proper YAML — be the only writer.

### 7. Dedup before creating a slug

**The motivating case:** `works/how-long-blues` was a lyrics-only scrape from Feb
2026. Issue #208 supplied the same song *with* chords and artist. The pipeline
created a second work instead of enriching the first, because nothing checks
submissions against the corpus.

It came through the reviewed path, with a human approving it. **No login gate —
A or B — would have caught it. Dedup would have.** That's the argument for
prioritising this over the login work.

**Fix the scorer first.** `dedup_works.py` fails here for two independent reasons
and fixing either alone still misses: it only compares the first 300 characters,
and it compares them in order. The two works order chorus and verse differently,
so the windows barely overlap. Use full lyrics and word-set overlap instead.

**Use containment, not Jaccard.** A lyrics-only work is nearly a *subset* of a
fuller submission. Jaccard punishes the size difference; containment doesn't.
High containment + big size gap = enrichment. High containment + similar size =
the same song twice. That distinction picks the outcome:

| What matched | What to offer |
|---|---|
| Existing work is sparser, incoming is richer | **Enrich it** — add the part, don't make a slug. The #208 case. |
| Match is archived | **Promote it** — instant, via Step 2 |
| Match is comparable, different chart | **Add as an arrangement** |
| No match, or user overrides | **Add as new** |

Enrichment is the safest to automate: adding chords to a lyrics-only work can't
destroy anything. That's "gate on what the change does, not who submitted it" in
its narrowest form.

**Build the CI-side check first** (catches everything, including human-approved
submissions), the editor warning second (nicer, but bypassable).

**Composer is a dedup signal, not a feature.** Same title + different composer is
good evidence of *different* songs — Will the Circle Be Unbroken is two songs, the
1907 hymn and A.P. Carter's 1935 rewrite. That matters because containment is
*more* prone to false merges than what it replaces. There's a one-character bug
dropping composers today (the regex wants `{meta: composer: X}`, the documented
form is `{meta: composer X}`); fix it because it's free and feeds this. Don't
invest in composer coverage or backfill beyond that.

**Test with #208 itself** — a real miss from the real pipeline with a known
answer. And keep the known false-positive pairs below threshold: "I Walk Alone" /
"I Walk The Line", "Good Hearted Woman" / "Good Hearted Man".

---

## Waiting on you

**Merge `how-long-blues` / `how-long-blues-1`.** Authoritative data, untouched.

Your call was to keep `-1` since it dominates. It nearly does — chords, artist,
6 sections vs 4 — but **not strictly**: the original has a closing verse `-1`
lacks ("Cruel engineer can't you see / I need my baby back with me / Then I'd be
rid of these mean ol' lonesome blues").

**Suggested:** keep `-1` canonical, port that verse across, add
`composers: [Leroy Carr]` by hand (the regex bug dropped it), then suppress the
original with a redirect. `merge_works.py` handles redirects.

---

## Deferred

- **Auto-approve for logged-in-but-untrusted users.** Once Step 7 exists,
  "is this change additive?" is computable, and login becomes one input to a
  threshold rather than the gate. Decide then, with data.
- **Rate limiting.** Not needed at 25 lifetime submissions. Revisit if Step 4
  opens `pending_songs` writes beyond trusted users.
- **#207 (pending submissions across devices).** Falls out of Step 4 free.

---

## Appendix — verification

Everything below was checked in-session against this worktree. Skip unless
something above looks wrong.

### Anchors

| Claim | Where |
|---|---|
| `promoted_songs` world-readable, unread by frontend | `supabase/migrations/20260814000000_promote_songs.sql`; `docs/js/supabase-auth.js:257,285`; stale comment `docs/js/main.js:1431` |
| `pending_songs` overlay, unfiltered, no auth | `docs/js/main.js:1196-1204`, `:1253` |
| Trusted branch → direct commit | `docs/js/editor.js:830,906,960` |
| Fire-and-forget commit | `docs/js/editor.js:916` |
| Cleanup deletes on any deploy | `supabase/functions/cleanup-pending/index.ts`; `.github/workflows/cleanup-pending.yml` |
| No function deploy CI | `grep -rn "supabase/functions" .github/` → nothing |
| Attribution code is correct | `supabase/functions/create-song-issue/index.ts:66,89` |
| Overwrite / unquoted YAML / no suppression check | `supabase/functions/auto-commit-song/index.ts` vs `scripts/lib/process_submission.py:150-190` |
| Composer regex | `scripts/lib/process_submission.py:126` |
| Existing dedup + merge tools | `scripts/lib/dedup_works.py`, `scripts/lib/merge_works.py` |
| Jaccard helper already in repo | `scripts/lib/build_works_index.py:600-607` |
| Known false positives | docstring, `build_works_index.py:570` |

### Measurements

`how-long-blues` vs `how-long-blues-1`, from `origin/main`:

| Metric | Score |
|---|---|
| `dedup_works.py` as written (300-char window, `SequenceMatcher`) | **0.043** — threshold 0.5, **miss** |
| Full text, `SequenceMatcher` | 0.188 |
| Full text, Jaccard over word sets | 0.646 |
| Full text, containment (∩ / smaller side) | **0.886** |

Composer regex, measured:

```
{composer: Leroy Carr}        -> 'Leroy Carr'
{meta: composer: Leroy Carr}  -> 'Leroy Carr'
{meta: composer Leroy Carr}   -> None      <- the documented form
```

### Notes

- `curation/index_prune.csv` is 17,089 pre-existing ids, so new works are never
  pruned — the `USER_SOURCES` carve-out is belt-and-braces. `user-submission`
  (doc uploads) is missing from that set; harmless today, worth fixing in Step 6.
- Both `will-the-circle-be-unbroken` works are indexed, not archived.
- `docs/js/__tests__/otf-editor/submit-tab.test.js:52` asserts the Rando
  fallback and must change in Step 4.
