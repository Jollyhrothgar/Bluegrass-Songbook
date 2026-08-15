# Bounty Board Cleanup Plan (Aug 2026)

Split the bounty board into a **canonical catalogue** (expensive, MusicBrainz-
derived, produced locally and committed) and a **wanted list** (cheap
subtraction, generated in CI), with a durable adjudication ledger for the
identity calls no algorithm — and no external identifier — can make.

---

## 1. Diagnosis

### How the board was actually built

The Aug 1 refresh (`cde9ef3a5`) was **not** a simple fuzzy title match. It was a
final scan against the local MusicBrainz mirror that took the **full outer
union** of several sources-of-truth from different research runs to define the
canonical bluegrass catalogue; the bounty board is the residual after
subtracting what the songbook has.

That matters for two reasons, and they pull in opposite directions:

1. **The expensive half can never run in CI.** The MB mirror is a local
   Postgres container (port 5440) — `scripts/lib/CLAUDE.md` already classes
   MusicBrainz work as "Local only", with the established pattern being *run
   locally → commit the cache → CI reads the cache* (`artist_tags.json`,
   `bluegrass_recordings.json`, `grassiness_scores.json`).
2. **The cheap half goes stale constantly.** Catalogue-minus-corpus changes on
   every import, and that subtraction needs no MB access at all.

Conflating the two is the actual structural defect. There is no single
generator that could be committed and run — which is why nothing was.

### Why the reported entries slipped through

| Wanted entry | What we actually have | Why matching missed it |
|---|---|---|
| `Can the Circle Be Unbroken (By and By)` | `will-the-circle-be-unbroken{,-1,-2}` — all indexed, 3–4 chords | Can ≠ Will → 0.87, below any safe auto-threshold |
| `Pallet on the Floor` | `make-me-a-pallet-on-the-floor` (5 chords), `make-me-a-pallet-on-your-floor` (4), `pallet-on-your-floor` (2) — all indexed | Best-fuzzy-match picks the **wrong** candidate: `Carpet on the Floor` scores 0.84, beating every real match |

Both are alias / word-order problems, not threshold-tuning problems. Match on
**candidate sets, never best-match-only** — that inversion is precisely what put
`Carpet on the Floor` ahead of the real Pallet works.

### Tested and rejected: MusicBrainz work IDs as the join key

The obvious fix is to stop matching strings and join on MB work IDs.
`bg_query.sql` does select `lrw.entity1 AS work_id`, and the raw export still
exists (`~/workspace/bluegrass_list/bg_coverage.csv.gz`, 75,356 rows) even
though every committed downstream artifact dropped the column. **Tested against
the raw export — it does not work:**

```
rows with work_id:                         15,744 / 75,356  (20.9%)
work_ids with >1 distinct title spelling:  0

CIRCLE   work_id=12450881  'Can the Circle Be Unbroken (By and By)'
         work_id=12451270  'Will the Circle Be Unbroken?'
         work_id=13806275  'Will the Circle Be Unbroken'
PALLET   work_id=12445814  'Make Me a Pallet on Your Floor'
         work_id=12723531  'Make Me a Pallet on the Floor'
```

Three failures at once: the `LEFT JOIN l_recording_work` misses 79% of
recordings, so coverage is far too sparse for a primary key; `COALESCE(w.name,
r.name)` makes work_id → title 1:1 by construction, so it supplies no
title-variant clustering; and **MusicBrainz fragments the exact songs in
question across separate work entities** — it has three distinct works for Will
/ Can the Circle and two for Make Me a Pallet.

The consequence is the important part: **the outer union inherited MB's own
fragmentation.** The board's duplicates are not merely a title-matching artifact
downstream — the canonical catalogue itself contains the same song several
times, because its authority does. No external identifier will fix this. Song
identity is a judgment we have to own.

(MB's `l_work_work` relations could cluster some of these, but only within the
21% that have work IDs at all. Worth a look someday; not a foundation.)

### Measured scope (696 entries, against index 2,458 / archive 16,764)

| Class | Count | Notes |
|---|---:|---|
| Resolve to an indexed work at ≥0.93 | 12 | provably spurious |
| Resolve by stopword-free token containment | 17 | `Pallet on the Floor`, `Johnson Boys`, `Grey Eagle` |
| Gray band 0.80–0.93 | 58 | needs adjudication |
| Annotation-suffix entries | 38 | `Sally Ann via Tommy Jarrell, mostly 1 & 4` |
| Non-song junk | 4 | `Band Introductions`, `Band Intros`, `Talk`, `Age Bluegrass Album Band` |
| Instrumentals mistyped `Vocal` | 38 | `Clarinet Polka`, `Flatbush Waltz` |
| Thin schema (title/type/source only) | 488 | bare cards, empty artist line |

The gray band is a coin flip and must not be automated:

```
0.92  Come All Ye Tenderhearted  -> Come All You Tender Hearted   TRUE
0.91  Sweet Thing                -> Sweet Thang                   TRUE
0.89  500 Miles                  -> 900 Miles                     FALSE
0.86  Foggy Mountain Rock        -> Foggy Mountain Top            FALSE
0.84  Pallet on the Floor        -> Carpet On The Floor           FALSE
```

Two artifacts of the union worth naming:

- **Annotation suffixes come from Strum Machine.** `strum_machine_cache.json`
  carries a `label` field (`"4/4 version"`); SM's catalog glues it into the
  display name and `sm_missing_vocals.json` (832 bare strings) inherited it.
  This is also the source of the intra-list duplicates — Shady Grove ×2,
  Cotton-Eyed Joe ×2, Sweet Sunny South ×2, Another Day Another Dollar ×2.
- **The thin half is one source, blanket-typed.** All 488
  `wanted_source: strum-machine` rows are typed `Vocal` (the ledger filename
  says "vocals"), so fiddle-tune bounties render under "More Songs" with no
  instrument chips — `bounty-view.js` routes purely on `type`. `core` also
  collapsed 82 → 19 because the union dropped rich fields instead of merging
  them.

### Archived-coverage hypothesis: negative, with a better finding next door

**Zero archived works title-match a wanted entry at ≥0.93**; ~6 plausible ones
sit in the gray band (`Come All You Tender Hearted`, `Sweet Thang`, `Roxanna
Waltz`, `Bunch of Keys`, `Aura Lee`, `Come Along John`). The prune rule and the
catalogue agree with each other — a useful consistency check, not a scandal.

The real hidden-coverage bucket is **611 indexed works that are lyrics-only**
(`has_content: true`, `chord_count: 0`), largely from `bl_fallback.py` — an
import this campaign itself performed. Wanted entries land on `sally-ann`,
`my-native-home`, `bill-cheatham`, `buffalo-gals`, `the-bluest-man-in-town`,
`paddy-on-the-turnpike`. **The board advertises these as "Missing Jam Standards"
while its own "Needs Chords" section lists the same works.**

---

## 2. Plan

### Phase 1 — Shared title matcher

`scripts/lib/title_match.py` + `docs/js/title-match.js`, driven off one shared
fixture so the implementations cannot drift:
`tests/fixtures/title_match_cases.json`, asserted by **both** pytest and vitest.

Ladder: NFKC + lowercase + quote normalization → strip annotations (` via …`,
trailing `modal|major|minor`, `w/…`, `N bars`, `N/N time`, parentheticals) →
`&`→`and`, drop punctuation → normalize articles at **both** ends (the data
contains `Last Song, The`, `Mountain House, The`, `Bluest Man in Town, The`).

Tiers: exact-normalized → **auto**; token-set equality → **auto**; fuzzy ≥0.93 →
**auto**; token-set containment → **queue**; 0.80–0.93 → **queue**; below → miss.

This is a *narrowing* tool that proposes candidates. It never decides identity.

### Phase 2 — Catalogue builder (local only, output tracked)

`sources/bounty-hunt/src/build_catalogue.py` — reconstructs and freezes the
outer union that currently exists only as one-off research output.

Inputs (all present; the MB-derived ones need the local mirror):

| Ledger | File | Contributes |
|---|---|---|
| MB cover-coverage | `curation/decision-data/site_index_scored.csv` (+ `bg_coverage.csv.gz`) | `coverage`, `core` |
| MB recordings | `docs/data/bluegrass_recordings.json` | `artists` |
| Strum Machine | `docs/data/sm_missing_vocals.json` | titles (split label, collapse variants) |
| BluegrassLyrics | `sources/bluegrass-lyrics/parsed/` (1,818) | vocals |

**Output: `docs/data/bluegrass_catalogue.json` — tracked in git**, alongside
`artist_tags.json` and friends, and added to the cache-file list in
`scripts/lib/CLAUDE.md`. This is an *input*, not build output: it costs a local
MB mirror to produce and changes only when a research run happens.

Every row carries a **`catalogue_id`** — a slug we own, stable across research
runs — plus `title`, `title_variants[]`, `sources[]`, `coverage`, `core`,
`artists`, `type`, `instruments`. Byte-stable output (sorted keys and rows).

Type inference replaces the blanket `Vocal`: ledger tags → title regex
(`waltz|reel|jig|hornpipe|breakdown|rag|polka|march|two-step|schottische`) → BL
presence implies vocal.

### Phase 3 — Catalogue-internal dedupe

Distinct from Phase 4, and it has to come first. Because the union inherited
MB's fragmentation, **the catalogue contains the same song more than once**
before the corpus is even consulted: `Will the Circle Be Unbroken` /
`Will the Circle Be Unbroken?` / `Can the Circle Be Unbroken (By and By)` are
three MB works and would be three catalogue rows.

Phase 1 proposes clusters; verdicts merge rows under one `catalogue_id` with the
losers recorded in `title_variants[]`. Deduping here means each song is matched
against the corpus **once**, instead of once per spelling — which is most of why
the current board double-lists.

### Phase 4 — Wanted-list generator (CI, gitignored)

`sources/bounty-hunt/src/build_wanted.py` — pure, cheap, no MB access:

```
bluegrass_catalogue.json  −  (index.jsonl ∪ archive.jsonl ∪ works/)  ±  ledger
                          =  wanted_songs.json
```

This is the half that goes stale, so it runs in `scripts/bootstrap` **and**
`.github/workflows/build.yml` before the index build and the `docs/` upload, and
`docs/data/wanted_songs.json` gets gitignored — the repo rule (*if a build
produces it, git doesn't track it*) applies cleanly here, and only here.

**Verify before flipping:** the four `process-*.yml` automations must not read
the file without generating it first. The scraper scripts run locally, but that
needs confirming rather than assuming.

Output schema, uniform on every row — no more two-tier cards:

```json
{
  "catalogue_id": "carroll-county-blues",
  "title": "Carroll County Blues",
  "type": "Instrumental",
  "sources": ["mb-coverage", "strum-machine"],
  "coverage": 18, "core": true,
  "artists": ["Fred Price", "..."],
  "instruments": ["fiddle", "banjo", "mandolin", "guitar"],
  "key": null, "difficulty": null, "notes": null,
  "title_variants": ["Carroll County Blues 4/4 version"]
}
```

### Phase 5 — Adjudication ledger

`curation/bounty_decisions.yaml` — tracked, permanent, survives regeneration.
Same proven pattern as `sources/bounty-hunt/review_decisions.json` (which
already caught the Xavier Rudd "Stoney Creek" error).

**Keyed on `catalogue_id`, never on a raw title string** — the union's spellings
vary between research runs, so a title-keyed decision silently detaches the next
time the catalogue is rebuilt.

```yaml
same_song:        # catalogue-internal merge (Phase 3)
  will-the-circle-be-unbroken:
    merge: [can-the-circle-be-unbroken-by-and-by, will-the-circle-be-unbroken-q]
    reason: "One jam tune; MB fragments it across three work entities"
    decided: "2026-08-15"

covered:          # catalogue song IS this work — drop from the board (Phase 4)
  pallet-on-the-floor:
    work: make-me-a-pallet-on-the-floor
    reason: "Same tune; we hold three arrangements"

distinct:         # looks similar, is a different song — keep on the board
  500-miles:
    not: 900-miles
    reason: "Hedy West song, unrelated to the 900 Miles fiddle tune"

not_a_song:
  band-introductions: { reason: "SM catalog artifact" }
```

CLI mirroring the existing `curate` verbs:

```bash
./scripts/utility bounty review                        # queue + candidates + chord counts
./scripts/utility bounty resolve <id> --covered <work-id> --reason "..."
./scripts/utility bounty resolve <id> --distinct <work-id> --reason "..."
./scripts/utility bounty resolve <id> --merge <id,...> --reason "..."
./scripts/utility bounty resolve <id> --not-a-song --reason "..."
```

Seed the bulk first (29 provable + 4 junk + 38 annotation collapses), then work
the ~58 gray band by hand.

### Phase 6 — Frontend

`docs/js/bounty-view.js`:

- Import the shared matcher; filter wanted entries against `allSongs` **at
  render**, so the page stays honest between builds when contributions land in
  `pending_songs` and the static JSON can't know.
- Split the outcome rather than just dropping: match **with chords** → drop;
  match **lyrics-only** → route into "Needs Chords", deduped against
  `computeChordGaps()` so it doesn't double-render.
- Section routing then reads the corrected `type`, so fiddle-tune bounties land
  under instrumentals with their instrument chips.

### Phase 7 — Verification

- **pytest**: matcher tiers; catalogue and wanted-list determinism (two runs,
  byte-identical)
- **vitest**: JS matcher parity against the shared fixture
- **Regression guard**: assert `Can the Circle Be Unbroken` and `Pallet on the
  Floor` do not render — the two entries that prompted this work
- **Invariant**: no rendered wanted entry resolves to an indexed work

---

## 3. Dependency: the Dungeon promote flow

Archived works the ledger confirms as real coverage should be restored through
the **existing** promote path — `promoted_songs.json` → hourly sync workflow →
build unions it with registry `keep:` — not a new mechanism.

That ships on `feature/bluegrass-dungeon`, **not yet merged to main**, still
needing `supabase db push` and a live promote test. ~6 candidates depend on it;
small enough that this cleanup should not block on the merge. Sequence it after.

---

## 4. Suggested execution order

1. **Phase 6 frontend dedupe — ship first.** Independent of everything else; the
   spurious cards stop rendering immediately.
2. Phase 1 matcher + fixture (unblocks 2–5, testable in isolation)
3. Phase 2 catalogue builder, then Phase 3 dedupe with a real review pass
4. Phase 4 generator, still writing the tracked file (diffable review)
5. Phase 5 ledger: bulk seed, then the gray band
6. Phase 7 tests
7. Flip `wanted_songs.json` to generated + gitignored once CI is verified green
8. Post-merge: promote the confirmed archived works via the Dungeon flow
