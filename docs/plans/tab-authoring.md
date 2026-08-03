# Plan: Tab authoring — upload, personal bucket, promotion

**Status:** ready to build. Written 2026-08-02 at the end of a long session,
specifically so the build can start from a fresh context.

**How to use this doc:** it is self-contained. You should not need to re-derive
anything below — every claim was verified in-session and the file/line anchors
are real. Start at [Step 0](#step-0--make-the-existing-pipeline-reachable).

> The repo-root `PLAN.md` (AlphaTab pivot, 2026-05-30) was **deleted 2026-08-02**
> at Mike's direction. It was never started — `alphatab` appeared nowhere in
> `package.json` or `docs/` — and the project went the other way, shipping the
> custom SVG renderer + Web Audio player + OTF editor. It's in git history if
> anyone wants it back.

---

## The goal, in Mike's words

> "I want this site to be an index of good enough tabs, plus a repository of
> tabs that I might want to learn. But I don't want the index polluted by my
> passion projects."

> "I want using this site to feel as seamless as using a desktop application.
> But with a layer of quality curation."

> "The tab editing and authoring is still rough, but I want to be able to start
> using it so it improves (because I'll find bugs)."

Two clarifications he gave that shaped the design:

1. **Git storage is fine.** The worry is the *index*, not the repo. An earlier
   draft of this plan optimised for keeping user tabs out of git — that was
   solving the wrong problem.
2. **Supabase is for latency, not isolation.** He wants uploads to appear
   immediately; git can catch up asynchronously.

---

## Design decision: three independent dimensions

The thing that unlocks this is refusing to conflate storage with visibility.

| Dimension | Mechanism | Timing |
|---|---|---|
| **Latency** — "I see it now" | Supabase overlay (`mergeCorpus` pending rows) | instant |
| **Durability** — "it survives" | git `works/` via the existing PR pipeline | async, may lag |
| **Visibility** — "is it in the index?" | the `indexed` flag | a curation decision |

Once separated, *immediate + in git + not in the index* is coherent, which is
exactly what was asked for.

**Rejected: a filesystem/folder model.** Mike floated it ("edging up to needing
something file-system flavored, which feels like a big lift"). It isn't needed.
The filesystem urge here comes from conflating two things that already exist
separately: **visibility** (`indexed`, one boolean) and **organization**
(lists — owner-scoped, cloud-synced, multi-owner, already shipped). Folders
would add a third naming hierarchy competing with both. Revisit only if a week
of real use shows lists genuinely can't express the grouping.

---

## What already exists (verified — do not rebuild)

The tab pipeline is **complete end to end and unreachable from the app.** That
is the single biggest finding: this is mostly a wiring job, not a build.

| Piece | Where | State |
|---|---|---|
| In-browser TEF parser | `docs/js/tef-import/` | Byte-exact vs the Python oracle, golden-gated (`docs/js/__tests__/tef-import-golden.test.js`). Currently used **only by tests**. |
| Create-a-Tab page | `docs/create.html` | Drag-and-drop `.tef` import (`#import-file`, `accept=".tef"`, calls `parseTef`), from-scratch multi-track creation, mounts the editor. **Linked from nowhere.** |
| From-scratch flow | `docs/js/otf-editor/create-tab.js` | `INSTRUMENT_CHOICES`, `buildNewTab()`, localStorage draft (`DRAFT_KEY`). |
| Editor | `docs/js/otf-editor/` | Full editor + `work-edit.js` session wrapper (`createTabEditSession`, `resolveEditTrackId`). |
| Submit | `docs/js/otf-editor/submit-tab.js` | `submitTab({type, otf, title, instrument, workId, comment})` → `create-tab-pr` edge function → opens a **labeled PR containing the OTF file**. |
| PR finalisation | `.github/workflows/process-tab-pr.yml` | On label `tab-submission`/`tab-correction`: validates OTF, writes `work.yaml` provenance, rebuilds index. **Merging the PR is the approval.** |
| Supabase overlay | `docs/js/corpus.js` `mergeCorpus({canon, archive, pending})` | Pending rows overlay static rows client-side, no git involved. This is the latency mechanism. |
| Lists | `docs/js/lists.js` + `supabase/migrations/*public_lists*` | Owner-scoped RLS, cloud-synced, multi-owner. This is the organization layer. |
| Unindexed tier | `indexed: false` | Row stays in the corpus (deep links, lists, groups resolve) but search/collections exclude it. Already carries 16,764 works. |

Entry points that exist in `add-song-picker.js` today: **Upload Image**,
**Lyrics & Chords**, **Request a Song**. There is no Tab option — that's the gap.

---

## The blocker (must be solved before Step 2)

`apply_index_prune()` — `scripts/lib/curation.py:291`:

```python
if song.get('source') in USER_SOURCES or song.get('submitted_by'):
    continue          # user content is NEVER pruned
```

A user-submitted work is therefore **guaranteed indexed and unprunable**. That
rule protects contributors from having their submission silently buried, and it
should keep doing that — but it makes Mike's passion-project tabs the one
category that is *forcibly* indexed. Exactly backwards.

**The rule needs a distinction it doesn't have:** "contributed to the songbook"
(protect — never prune) vs "parked for later" (don't index).

**Approach:** add an explicit `unindexed:` set to `curation/registry.yaml` that
is **not** subject to the user exemption, and honour it in `apply_index_prune`
(or a sibling function) at build time.

Deliberately *not* reusing `curation/index_prune.csv`: that file is the record
of a specific 2026-07 editorial decision with its own decision doc
(`curation/INDEX_DECISIONS.md`). Mixing "I want to learn this someday" into it
would muddy both records.

Add the mirror verb next to the existing `unprune` (`scripts/lib/curate.py:165`,
verbs: `report/pin/suppress/pin-tab/unprune/exclude-tag/lint`):

```bash
./scripts/utility curate index <work-id>     # promote: drop the unindexed marker
./scripts/utility curate unindex <work-id>   # park it
```

**Default rule:** a tab submission that *mints a new work* starts unindexed.
A tab attached to an *existing* work changes that work's visibility **not at
all** — that's the common case and must stay frictionless.

---

## Steps

Sequenced so the thing Mike actually asked for (dogfooding the editor) happens
first and commits to none of the architecture.

### Step 0 — make the existing pipeline reachable — **DONE 2026-08-02**

**Hours. No backend. No index risk.** This is the one that serves the stated
goal: "start using it so it improves."

- Add a **Tab** card to the Add-a-Song picker (`docs/js/add-song-picker.js`;
  modal markup in `docs/index.html`, `#add-song-picker` / `.picker-cards`).
  Copy should say it handles a TablEdit `.tef` or a tab from scratch.
- Route it to the existing `docs/create.html`.
- Sanity-check `create.html` standalone: import a `.tef`, edit, download.

**Acceptance:** from the app, with no URL typing, Mike can import
`sources/mandolin-hangout/downloads/2927_tef_gold_rush___bill_monroe.tef`,
see it in the editor, and download the OTF. Nothing reaches the index.

**Commit separately** so it can ship even if Step 1 stalls.

### Step 1 — "Add a tab for this song" from a work page — **DONE 2026-08-02**

> **One thing this step discovered, and it matters for Step 3:** the
> `create-tab-pr` edge function *ignores* `workId` when
> `type: 'tab-submission'` — it slugifies the title and probes for a free
> `works/<slug>`. Only `tab-correction` honours it. So the bound flow
> submits as a correction, with a generated comment. That's not a hack
> for its own sake: `process_tab.py` appends a `parts[]` entry when the
> work has no tab for that instrument, so "correction" already means
> add-or-update. If a future step wants an honest `tab-submission +
> workId`, that's an edge-function change and a deploy.

**Small.** Makes the *good* path the easy path, and structurally prevents the
duplicate-work problem.

- Action on the work page (near Edit) that opens the create/import flow with
  `workId` pre-bound.
- Pass `workId` through to `submitTab` so the PR is a correction/addition to a
  known work — **no work-matching step needed, cannot mint duplicates.**

**Acceptance:** from `#work/black-mountain-rag/banjo-tab`, add a second banjo
arrangement; the resulting PR targets that work and adds a part rather than
creating a new work.

**Why this before any matching UI:** the duplicate risk only exists when a tab
mints a new work. Binding `workId` sidesteps it entirely for the common case.

### Step 2 — the personal bucket (design AFTER a week of Step 0/1 use)

Do not build this until Mike has used the editor for real. The shape below is
the current best guess, not a commitment.

- `pending_tabs`-shaped Supabase table (mirror the `pending_songs` pattern),
  merged via `mergeCorpus`'s `pending` channel carrying `indexed: false`.
- Solve the blocker above so the git-side copy is also unindexed.
- Organize with existing lists.

**Open question to answer with usage, not speculation:** is the bucket a list,
a flag, or something not yet named?

### Step 3 — promote

`curate index <work-id>` + a UI affordance ("propose for the songbook") that
routes into the PR flow already built. Small once Step 2 exists.

---

## Verification recipes

```bash
./scripts/server                 # picks a free port; 8080 is Docker, Mike used 8090
uv run pytest -q                 # 398 pass, 1 skipped
npx vitest run                   # 1431 pass across 57 files
```

**Gotcha that cost ~an hour this session:** the dev server serves **stale JS
modules**. A normal reload is not enough — the page will run old code and you
will chase phantom bugs. Force a hard reload (`cmd+shift+r`) after every JS
edit before believing what the browser shows.

Second gotcha: `showView('x')` is a **no-op when the view is already `x`**, so
the `currentView` pub/sub does not fire. Never rely on that subscriber to
render something an entry point needs; call it explicitly. This is what made
"All songs" render blank.

---

## Open threads (not part of this plan)

- **Drum line→instrument mapping.** Percussion is detected correctly and shown
  greyed as "in progress". The line→drum mapping is *not* solved; two candidate
  encodings are **falsified** and recorded in `sources/banjo-hangout/CLAUDE.md`
  so they aren't re-tried. `drum_kit.json` holds TablEdit's 51-drum table for
  whoever picks it up. Next lead: TuxGuitar's TablEdit importer.
- **`archive.jsonl` eager prefetch.** `main.js` idle-prefetches 16MB / **2.9MB
  gzipped** on *every* visit, for content almost no one opens.
  `ensureArchiveLoaded()` already handles the on-miss path. Dropping the eager
  prefetch is a real win but needs care — list views re-render when the archive
  merges. Not yet investigated.
- **Raw data / `sources/classic-country/raw`** (17,382 files, 151M of cached
  HTML, read by nothing). Every *other* source gitignores its `raw/`.
  **Deferred by Mike** until it needs managing.
- **Editor quality.** The reason for Step 0. Expect bug reports to arrive as
  soon as it's reachable.
