# Plan: Contribution pipeline

**Status:** SHIPPED 2026-08-16 — merged to main (PR #234, migration fix
#237), edge functions CI-deployed, all five migrations applied to prod
and verified, reconciler drift **0**. Milestone #12: issues #215–#229
closed, follow-ups #233/#235/#236 open. Written 2026-08-15 on
`feature/promote-workflow`.
Rescoped 2026-08-15 after a full audit of every contribution path (17 found;
the first draft covered 5) and an interview that settled the open policy
questions. Decisions are in the body; the [appendix](#appendix--verification)
has file anchors and measurements — you should not need to read it.

---

## The contract

Four properties, in tension, resolved in this order:

1. **Easy to add.** Login is the only requirement to contribute — it supplies
   identity, not permission.
2. **Instant to merge.** Additive changes go live in seconds for *any*
   logged-in user. Trust tiers gate risk, not speed.
3. **Hard to destroy.** Nobody edits someone else's content in place. An edit
   to another contributor's chart becomes a **new arrangement** on the same
   work — the original is untouched and voting/curation picks the default.
   This is the Guitar Pro stance, and the app has already built it: multi-part
   works, `x_version_*` metadata, the Arrangement pill, vote-backed defaults.
   Destruction becomes structurally impossible on the add path, not merely
   monitored. Git history remains the deep undo.
4. **Easy offramp.** "This song already exists" is a choice offered at submit
   time — enrich / promote / add as arrangement — not a rejection discovered
   later.

**The gate is the change, not the person** (promoted from Deferred — it was
the whole point all along):

| Change class | Who | What happens |
|---|---|---|
| New work, new part, new arrangement, enrichment | any logged-in user | instant |
| Edit own content in place | author or trusted | instant |
| Edit someone else's content | anyone | forks to a new arrangement, instant |
| Delete, suppress, merge-redirect | trusted + review | queued |
| Flag a problem, request a song | anyone, no login | issue/report only |

**Binary doc uploads are killed, not gated (2026-08-15).** The pipeline
exists to make artifacts that are durable *and trackable* — diffable,
forkable, dedupable. A PDF is none of those: it can't take an arrangement
fork, can't enter the dedup scorer, can't be reviewed by diff. Rather than
build a review queue for the one content type the contract can't cover,
the feature goes away (see 2d).

**The GitHub issue flow for content is dead.** `create-song-issue` →
auto-label → human `approved` label → workflow was a review queue built out
of issue machinery. With additive-instant there is nothing for it to review.
`create-song-issue`, `process-song-submission.yml` and
`process-song-correction.yml` retire; GitHub issues go back to being for bug
reports and feedback. The small reviewed residue (deletions, suppressions,
merge-redirects) gets an in-app queue, not labels.

---

## The one idea (unchanged)

Three tiers, one rule.

| Tier | Where | Speed | Owns |
|---|---|---|---|
| **Live** | Supabase, world-readable, merged in the browser | seconds | writes in flight, curation decisions |
| **Durable** | `works/` in git | minutes | the corpus |
| **Reconcile** | sync workflow, cleanup | minutes | making the two agree |

> **The rule:** reconcile must never remove something from Live until Durable
> is actually serving it.

The rescope *raises* the stakes on this: the Live overlay stops being a
trusted-user perk and becomes the delivery mechanism for every contribution.

### Decided: don't move the corpus into Supabase (2026-08-15)

Considered seriously, because the dual-write is genuinely expensive. **The
reason not to isn't that git is sacred.** It's that the problem is not which
store is primary — it's that `pending_songs` holds *content*. Supabase owning
decisions and git owning content is a clean split; `pending_songs` straddles
it, and that straddle generates the reconciler, the cleanup race, and the
drift. The one-writer step fixes exactly that seam — and the rescope
strengthens this decision: with every path funneled through one writer, the
split gets cleaner, not messier.

The migration cost is **12 scripts**, not the data — everything in
`scripts/lib/` walks directories. And you'd lose per-work history, which git
gives free.

**Revisit if:** after Phase 1, reconciliation is still painful. At that point
there's one write path to redirect instead of five, so the migration is
cheaper than it is today. Nothing here is wasted either way.

---

## What we got wrong walking in

Five things turned out to be false. The first three shrank the work; the last
two grew it — which is why this document was rescoped.

1. **Promote doesn't need an edge function.** `promoted_songs` is already
   world-readable — the frontend just never reads it. A client-side overlay
   gets **zero** latency in ~15 lines.
2. **Trusted-user direct add already ships.** `auto-commit-song` commits to
   `works/` today; 24 works came in that way. The problem isn't that the path
   doesn't exist, it's that it isn't safe.
3. **`dedup_works.py` would not have caught #208.** It scores that pair 0.043
   against a 0.5 threshold — a clean miss, not a near miss.
4. **"Two things write works" undercounted.** Five do:
   `process_submission.py`, `process_correction.py`, `process_tab.py`,
   `fetch_tune.py`, and `auto-commit-song`. Unifying two of five would have
   left the disagreement class alive.
5. **The plan covered 5 of 17 contribution paths.** The audit found a
   dead-end doc-upload path that lies to the submitter, tag/genre pipelines
   that only work if you personally run a script, a tab-submission API with
   no UI, and an importer that mints duplicates the same way submissions do
   (#192).

---

## Phases

Ordered by ship order. Phase 0 is same-day and depends on nothing.

### Phase 0 — stop the bleeding

**0a. Stop songs vanishing mid-jam.** `cleanup-pending` deletes pending rows
on *any* successful deploy, but `auto-commit-song` marks a song committed
before CI even starts. So an unrelated deploy lands, the row is deleted, and
the song disappears from every phone in the circle until its own deploy
finishes. **Fix:** don't reap rows younger than 15 minutes. One line.

**0b. Promote and delete go live instantly.** Fetch `promoted_songs` and
`deleted_songs` alongside `pending_songs` and apply them client-side.
Promote goes from ~1 hour to zero. The hourly sync stops being the delivery
mechanism and becomes pure durability.

### Phase 1 — rails (everything else stands on these)

**1a. Deploy pipeline for edge functions.** Nothing in `.github/` deploys
`supabase/functions/` — all seven are hand-deployed, and production is
whatever someone last pushed from a laptop (this is why the attribution line
is missing from all 25 issues, and why `create-tab-pr` sits undeployed,
#180). Blocks every phase that touches function code — which is now all of
them. **Risk:** first run deploys seven functions whose current prod state is
unknown. Hand-deploy once to a known baseline, then let CI take over.

**1b. Make the reconciler real.** The commit is fire-and-forget
(`.catch(console.warn)`). A failed commit leaves a row nothing retries and
nobody hears about. Needs a retry pass and an alert. **Measure first:** count
rows where `github_committed = false` — that's the current drift and may
contain songs needing manual rescue.

**1c. One writer for `works/` — a shared library, all five paths.** Extract
one Python works-writer (collision handling, suppression check, proper YAML,
provenance, and the new **fork-to-arrangement rule**) and converge
`process_submission.py`, `process_correction.py`, `process_tab.py`,
`fetch_tune.py` on it. `auto-commit-song` stops authoring YAML in TypeScript
(today it overwrites existing works and emits `composers: [Smith, John]`
unquoted as two composers) and reduces to enqueue + dispatch. The writer
library is where "hard to destroy" is *enforced*: in-place overwrite is
refused unless author-or-trusted; a collision routes to the arrangement fork
or the dedup offramp. Also: add `user-submission` to the prune carve-out
while in here.

### Phase 2 — the new contract

**2a. Login required to write; anonymous keeps report/request.** Flag a
problem or request a song without an account (a confirmation toast is a
complete experience); everything a user will later go looking for requires
login. This **deletes** the attribution problem — "Rando Calrissian" and the
client-supplied `submittedBy` field go away; identity comes from the verified
session. (`submit-tab.test.js:52` asserts the Rando fallback and must
change.)

**2b. Additive = instant for any logged-in user.** All text-content
submissions (lead sheets **and** OTF tabs — text, diffable, validatable)
flow: Supabase `pending_songs` overlay → live in seconds → shared writer →
durable in minutes. Trusted status stops gating speed and only distinguishes
in-place edit rights. Retire `create-song-issue`,
`process-song-submission.yml`, `process-song-correction.yml`; tab
corrections leave the PR flow and join the same pipeline (validation moves
into the writer; `process-tab-pr.yml` retires too). **New rail required by
opening the gate:** per-user rate limits and size caps on the write path —
the Deferred rate-limiting item lands here, not later.
*Deviation, 2026-08-15:* the tab half shipped separately — 2b delivered the
lead-sheet pipeline and retired the song-issue flow, while `create-tab-pr` /
`process-tab-pr.yml` stayed live pending 4c.

*Regression, 2026-08-15 → 2026-08-18:* "durable in minutes" ended at git, not
at the site. Retiring `process-song-submission.yml` /
`process-song-correction.yml` left their names in `build.yml`'s `workflow_run`
trigger list and never added the replacement, `"Process Pending Submission"`.
Since pushes made with the default `GITHUB_TOKEN` do not start workflows,
every submission for three days reached `works/` and never deployed — and
`cleanup-pending.yml`, which keys on `CI & Deploy` succeeding, stopped reaping
the rows it committed. Fixed by correcting the list; `tests/
test_workflow_deploy_triggers.py` now fails CI if it drifts again. **Anyone
retiring or renaming a content workflow must update that list** — it matches
`name:` strings and GitHub reports nothing when an entry matches nothing.
*Closed, 2026-08-18:* the tab half landed as written above — OTF rows on
`pending_songs`, validation in the pipeline, `create-tab-pr` and
`process-tab-pr.yml` deleted. See the reversal note under 4c below.

*Resolved at 4c, 2026-08-15 — **tabs keep the PR flow**.* The overlay this
paragraph assumes doesn't exist for tabs: `pending_songs` is one row per
SONG with a `content text` column holding ChordPro, no notion of parts or
instruments, and the site loads a tab by fetching its `.otf.json` file, not
from the overlay. Moving tabs onto it means a parts-aware overlay row, an
overlay branch in the tablature loader, and OTF validation lifted into the
shared writer — a Phase-2-sized rebuild, not the wiring 4c is. Half-doing
it would leave the only tab surface split across two servers, so
`create-tab-pr` + `process-tab-pr.yml` are the durable path for tabs until
someone chooses that rebuild deliberately.

***Reversed, 2026-08-18 — the rebuild was chosen and done.*** Mike took the
Phase-2-sized option rather than keep the exception. Nothing in the 4c
reasoning was wrong; it was a cost estimate, and the cost got paid:

* `pending_songs` is parts-aware —
  `20260818000000_pending_songs_tablature.sql` adds `part_type` /
  `instrument` / `part_file`, and a per-kind content cap (200KB chart, 2MB
  OTF) because the chart cap would have rejected exactly the multi-track
  tabs most worth having.
* Tab rows got their own id namespace, `tab:<slug>:<rand>`, targeting a
  work through `replaces_id`. `pending_songs.id` is a primary key and, for
  a chart, IS the work slug — one row per song. That is the wrong shape for
  a part: two people tabbing the same song collided on the PK, and because
  the update policy gates on `created_by = auth.uid()` the second one failed
  as a *permissions* error about something else entirely. A pending chart
  and a pending tab for one song could not coexist either. A tab `create`
  therefore names its work from the TITLE, and `create_work`'s
  suffix-on-collision resolves the real slug against a checkout of main —
  the free-slug hunt `create-tab-pr` approximated by probing the Contents
  API from a branch that could not see other branches.
* OTF validation moved into the pipeline: `validate_otf` came out of
  `process_tab.py` into `process_pending.py`, which then writes through
  `works_writer` like everything else. No second writer was added.
* `classifyChange` gained `add` — the tab column's `fork`. A "correction"
  from someone who does not own the tab lands as a sibling arrangement, so
  "hard to destroy" holds in both columns.
* `create-tab-pr/`, `process-tab-pr.yml` and `process_tab.py` are
  **deleted**.
* `notes` and `status` finally got size/enum caps. The 2b cap pass skipped
  `notes` with the comment "pending_songs has no notes column" — it has had
  one since `20260217000000`, and that mistaken belief is also what PR #237
  acted on. It mattered here because a tab correction writes the
  submitter's comment into `notes`, making it the one user-controlled text
  column on the write path with no bound. `status` had none either, and
  `process_pending` copies it straight into `work.yaml`.

Found while doing it, and worth recording because it was latent in the
shipped 2b design: `submittersOf()` asked ownership of the whole work.yaml,
not of the part type being edited. That was safe only because
`submitted_by` happened to appear on lead sheets alone. Tab rows carry it
now, so the loose question would have let submitting a banjo tab classify a
later edit of that work's CHART as `update` — and `update_target`'s
"owns no chart ⇒ they must be trusted" fallback would have overwritten
somebody else's primary chart and the work's title/artist/key with it. Both
classifiers now count only parts of the kind being edited. Regression test:
`TestTabOwnershipDoesNotBuyChartEdits` in `tests/test_process_pending.py`.

**Accepted exception, now closed:** this used to leave tabs review-gated
while text content was additive-instant — a new tab live on merge, not in
seconds, and shown in 4a as "Requested" rather than Live because there was
no `pending_songs` row behind it. There is one now, so a tab is Live like
everything else and the contract no longer says two different things
depending on what you contributed.

**2c. Fork-to-arrangement.** The editor's "edit" action on content you
don't own becomes "create your arrangement" — same work, new version part,
`x_version_*` populated, Arrangement pill and votes pick the default. No
review queue, nothing destroyed, friction stays zero. Voting landed
2026-08-16 (issue #233): `song_votes.arr_slug` gives every take of a work
its own ballot, votes rank the challengers in the pill, and the editorial
`default` flag still pins row one — when a fork out-polls it the pill says
so and names the file, but nothing flips on its own. **Forking is not just
the fallback for others' content:** you can fork your *own* versions too
(simplified chart, capo arrangement, different key) — "fork" and "edit in
place" are both first-class actions on content you own, and ownership only
decides whether in-place is offered at all.

**2d. The reviewed residue gets an in-app queue; the docs feature dies.**
Deletions, suppressions, and merge-redirects land in a small
trusted-user-facing queue in the app (the Dungeon is the natural home).
Doc upload is **removed**, which also resolves its dead end (today
`doc_staging` rows and the `doc-staging` bucket are read by *nothing* — no
workflow, no issue, while the UI says "Submitted for review!"). Tear-down:
the upload UI in `doc-upload.js` and `work-view.js` (both trusted and
regular paths), the attachment branch of `auto-commit-song`, and the
`doc_staging` table + `doc-staging` bucket (check for stranded rows/files
worth rescuing before dropping). Existing document parts already in
`works/` and the four published PDFs in `docs/data/docs/` stay served —
this kills the intake, not the shelf.
*Delivered, 2026-08-15:* teardown complete (module, view, picker card,
editor hatch, attachment branch, and the shared helpers only it used).
Queue shipped as `docs/js/review-queue.js` + `review_requests`, rendered in
the Dungeon: trusted users file, admins decide, admins keep the instant
delete. Approving a `delete` executes; approving a `suppress` or
`merge-redirect` records the decision and prints the local command, because
both edit files in the repo and no CI path does that from a table — the
panel says so rather than implying otherwise. The panel's third section
lists 3b's dedup holds (`pending_songs.dedup_hold`) with admin release /
reject. Migrations are written but **not applied**: the drop-`doc_staging`
one opens with a rescue checklist (and the bucket still needs a manual
delete), and `review_requests` also grants `is_admin()` update/delete on
`pending_songs` so the hold actions aren't blocked by the 2b policies.
*Addendum, 2026-08-16:* the first pass only wired an entry point for
`delete`; `suppress` and `merge-redirect` were fileable via `submitReviewRequest`
but had no UI. Closed: `🙈 Request suppression` and `🔀 Request merge into
another song…` join `🗑️ Request deletion` in the song overflow for any
trusted user (neither kind has an instant admin path, so both show
unconditionally on `isTrusted()`, unlike delete's admin/trusted split).
Merge-redirect's target search reuses `searchWorksForTab`
(add-song-picker.js) rather than growing a second corpus search. Checked
for a natural "these are the same song, request a merge" affordance on the
dedup offramp and the Dungeon's held-rows section — neither has one to add:
the offramp compares an unsaved submission against the corpus (nothing
published yet to merge), and a held `pending_songs` row was refused *before*
becoming a work, so its matched-work id lives only in the CI
`dedup_matched_work` output / GitHub issue, not the `dedup_hold` text column
the frontend reads — merge-redirect needs two already-published works, which
neither surface has in hand.

### Phase 3 — the offramp (dedup)

**The motivating case:** `works/how-long-blues` was a lyrics-only scrape.
Issue #208 supplied the same song *with* chords and artist; the pipeline
created a second work instead of enriching the first — through the reviewed
path, with a human approving it. No login gate would have caught it. Dedup
would have. Under additive-instant it matters more: the offramp replaces the
human who used to (fail to) notice.

**Fix the scorer first.** `dedup_works.py` fails for two independent reasons
and fixing either alone still misses: it compares only the first 300
characters, and in order — the two works order chorus and verse differently.
Use full lyrics and word-set overlap.

**Use containment, not Jaccard.** A lyrics-only work is nearly a *subset* of
a fuller submission. Jaccard punishes the size difference; containment
doesn't. High containment + big size gap = enrichment. High containment +
similar size = the same song twice:

| What matched | What to offer |
|---|---|
| Existing work is sparser, incoming is richer | **Enrich it** — add the part, don't make a slug. The #208 case. |
| Match is archived | **Promote it** — instant, via 0b |
| Match is comparable, different chart | **Add as an arrangement** — same mechanism as 2c |
| No match, or user overrides | **Add as new** |

Enrichment is the safest to automate: adding chords to a lyrics-only work
can't destroy anything — the contract's narrowest case.

**Both surfaces ship in the same milestone.** The scorer is one library; the
interactive editor offramp ("this looks like How Long Blues — enrich /
promote / new arrangement / it's new") and the CI-side backstop (catches
everything, including automated paths) are two thin callers of it. Neither
is optional: the editor surface is what makes the offramp *easy*, the CI
check is what makes it *complete*.

**Third caller: the importer.** `works_importer.normalize_title` mints
duplicate works with a weaker matcher than `cross_site_index.norm_key`
(#192) — same disease, different door. Point it at the same scorer.

**Signal order: lyrics > title > chords.** Nothing else.

- **Lyrics** are the only strong signal and the only one worth tuning.
- **Title** narrows candidates; it doesn't decide them.
- **Chords are not a matching signal** (half the canon is I-IV-V in G) — but
  chord *presence* decides the outcome: enrich vs duplicate.

**Composer is not a signal.** 12 of 19,228 works have one (0.1%); where it
exists it adds nothing lyrics don't already give.

**Instrumentals are the gap.** No lyrics, so title carries alone — exactly
where collisions are worst ("Blackberry Blossom"). The scorer must know it
has fallen back to a weak signal: with no lyrics on either side, require a
much higher title threshold, or decline to auto-act and just warn.

**Test with #208 itself** — a real miss with a known answer. Keep the known
false-positive pairs below threshold: "I Walk Alone" / "I Walk The Line",
"Good Hearted Woman" / "Good Hearted Man".

### Phase 4 — the contributor surface

**4a. "My submissions" (#207 — a real user asked for exactly this).** A
surface listing your contributions with live status. The first draft claimed
this "falls out of Step 4 free" — only true for the `pending_songs` path;
with the issue flow dead and *every* submission flowing through Supabase, it
now actually does: `pending_songs` + `submission_log` power it with no
GitHub join. Status vocabulary: live (overlay) → durable (committed) →
arrangement-of / enriched-into (offramp outcomes) → queued (reviewed
residue).

**4b. Tag votes and genre suggestions reach the site without you.** Today
`tag_votes` → `tag_overrides.json` and `genre_suggestions` → export both
require a human running a local script. Add them to the hourly sync
(`sync-deleted-songs.yml` is the template): trusted tag overrides apply
automatically — they're curation decisions, the Live tier already owns those
— genre suggestions export for review (free text stays human-judged).

**4c. New-tab submission UI.** *Shipped 2026-08-15.* `create-tab-pr`
supported `tab-submission` and `create-tab.js` existed, but nothing in the
site constructed the call — only tab *corrections* were reachable. Two
entry points now do, both gated on login at the click (2a):

- **From a work page** — the bounty section's Contribute button on a
  tablature bounty opens the tab editor pre-targeted at that work and
  instrument, and a "+ Add a tab" button does the same unprompted. This
  closes the bounty loop: "this work wants a banjo tab" → tab it → the
  part lands on that work.
- **From the add-song picker** — a Tablature card that asks which song the
  tab is for (searching the corpus with the same normalize+similarity pair
  the dedup check uses), then hands off. This is the surface that reaches
  works with no bounty and no gap in their part list.

Both route through `create.html` carrying `?work=&instrument=&title=`;
`create-tab-entry.js` owns the target contract and the submission payload.
Three gaps in the chain were real and are fixed: `create-tab-pr` ignored
`workId` on a submission and always minted a fresh slug (so a tab for an
existing song forked a duplicate work — it now targets the work, and 409s
rather than overwrite a published tab of that instrument); the client sent
the editor's PRESET name (`5-string-banjo`, and `tenor_banjo` — which the
server's own `[a-z0-9-]` check rejects) where the corpus wants `banjo`;
and `process_tab.py` stamped `x_corrected_*` on a part that had never been
published.

*Corrected, 2026-08-16 — that 409 was a principle-4 violation and is
gone.* The offramp now happens at ENTRY: the picker's result selection,
"+ Add a tab" and a tablature bounty's Contribute all check the target
work's `tablature_parts` client-side and, when the instrument is already
covered, offer view / add-alongside / improve-an-existing-tab before the
editor opens — with the sibling count repeated in `create.html`'s target
banner. Server-side, a same-instrument submission is no longer refused
but uniquified (`{instrument}-{base36 stamp+rand}.otf.json`, unique across
concurrent branches in a way `works_writer._unique_filename`'s `-2`
counter is not) and added as a NEW part, which is what the corpus has
always modelled — `process_tab.py` now keys correction-vs-new-part on the
FILE rather than the instrument, and stamps `source_id: pr-{n}` so
siblings satisfy the schema. Two related holes closed on the way: index
rows publish `src_file` and corrections name it, so fixing take #3 no
longer writes over take #1. It does NOT move tabs onto the
`pending_songs` pipeline — see
the resolved deviation under 2b for why, and for the review-gate exception
that leaves standing. Supersedes the new-tab half of #180; `create.html`
is now reachable from the site, which was #180's last checklist item.

---

## Done

**`how-long-blues` merged into `how-long-blues-1`** (2026-08-15, commit
`2e8373a39`): Tim's version is canonical, the original's closing verse
ported across with chords in the chart's idiom, `composers: [Leroy Carr]`
added, original suppressed with a redirect via `merge_works.py`. This pair
remains the Phase 3 scorer's primary test fixture — the pre-merge texts
live in git history.

## Delivery

Decided 2026-08-15: this doc stays the rationale; the work ships as a
**"Contribution pipeline" GitHub milestone** with one issue per phase item,
so pieces are trackable and delegable. Build work is delegated to cheaper
agents; review stays with the top-tier model.

---

## Deferred

- **Anonymous *content* writes.** The contract requires login for anything
  the user will later go looking for. If friction data ever says otherwise,
  the change-based gate makes relaxing this a policy tweak, not a rebuild.
- **Bounties processing.** The `bounties` table is a pure request board
  nothing reads — by design; it's a signal to other contributors, and paths
  2b/4c are how bounties get *fulfilled*. Leave it.
- **Auto-applying genre suggestions** above a vote threshold. Decide with
  data once 4b surfaces the volume.
- **Cleaning up legacy `song_flags` table** — orphaned since flags moved to
  issues; delete the table in a migration sweep whenever convenient.

---

## Appendix — verification

Everything below was checked in-session against this worktree (audit
2026-08-15 covered all 17 contribution paths). Skip unless something above
looks wrong.

### Anchors

| Claim | Where |
|---|---|
| `promoted_songs` world-readable, unread by frontend | `supabase/migrations/20260814000000_promote_songs.sql`; `docs/js/supabase-auth.js:257,285`; stale comment `docs/js/main.js:1431` |
| `pending_songs` overlay, unfiltered, no auth | `docs/js/main.js:1196-1204`, `:1253` |
| Trusted branch → direct commit | `docs/js/editor.js:830,906,960` |
| Fire-and-forget commit | `docs/js/editor.js:916` |
| Cleanup deletes on any deploy | `supabase/functions/cleanup-pending/index.ts`; `.github/workflows/cleanup-pending.yml` |
| No function deploy CI | `grep -rn "supabase/functions" .github/` → nothing |
| Attribution code is correct, prod is stale | `supabase/functions/create-song-issue/index.ts:66,89` |
| Overwrite / unquoted YAML / no suppression check | `supabase/functions/auto-commit-song/index.ts` vs `scripts/lib/process_submission.py:150-190` |
| Five writers of `works/` | `process_submission.py`, `process_correction.py`, `process_tab.py`, `fetch_tune.py`, `auto-commit-song/index.ts` |
| ~~Doc-upload dead end: nothing reads `doc_staging`~~ — feature removed in 2d (2026-08-15); table/bucket drop written but not applied, see `supabase/migrations/20260815130000_drop_doc_staging.sql` |
| Tag/genre sync is manual-only | `scripts/lib/fetch_tag_overrides.py`, `scripts/lib/export_genre_suggestions.py` — in no workflow |
| `tab-submission` supported server-side, no UI caller | `supabase/functions/create-tab-pr/index.ts`; `docs/js/otf-editor/submit-tab.js`; `create-tab.js` unwired |
| Importer duplicate minting | #192, `works_importer.normalize_title` vs `cross_site_index.norm_key` |
| Arrangement machinery already shipped | `x_version_*` metadata, Arrangement pill (`work-view.js`), `song_votes`/`song_vote_counts`, `curation/registry.yaml` |
| Existing dedup + merge tools | `scripts/lib/dedup_works.py`, `scripts/lib/merge_works.py` |
| Jaccard helper already in repo | `scripts/lib/build_works_index.py:600-607` |
| Known false positives | docstring, `build_works_index.py:570` |
| Rando fallback test (2a: now asserts no `submittedBy` + login required) | `docs/js/__tests__/otf-editor/submit-tab.test.js:72,82` |

### Measurements

`how-long-blues` vs `how-long-blues-1`, from `origin/main`:

| Metric | Score |
|---|---|
| `dedup_works.py` as written (300-char window, `SequenceMatcher`) | **0.043** — threshold 0.5, **miss** |
| Full text, `SequenceMatcher` | 0.188 |
| Full text, Jaccard over word sets | 0.646 |
| Full text, containment (∩ / smaller side) | **0.886** |

Composer coverage: **12 of 19,228 works** (0.1%).

### Notes

- `curation/index_prune.csv` is 17,089 pre-existing ids, so new works are
  never pruned — the `USER_SOURCES` carve-out is belt-and-braces.
  `user-submission` (doc uploads) is missing from that set; fixed in 1c.
- Both `will-the-circle-be-unbroken` works are indexed, not archived.
- Interview decisions (2026-08-15): additive = instant for any login;
  fork-to-arrangement for others' content and one's own; reviewed residue =
  deletions, suppressions, merge-redirects; GitHub issue flow killed for
  content; dedup ships both surfaces in one milestone; instant scope = all
  text content; **binary doc uploads killed entirely** (existing doc parts
  stay served); one shared writer library across all five paths; "my
  submissions" is an explicit deliverable.
