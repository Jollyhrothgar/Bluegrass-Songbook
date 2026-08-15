# Bounty Board Cleanup Plan (Aug 2026)

Split the bounty board into a **canonical catalogue** (expensive, MusicBrainz-
derived, produced locally and committed) and a **wanted list** (cheap
subtraction, generated in CI), with a durable adjudication ledger for the
identity calls no algorithm — and no external identifier — can make.

Status: adjudication is **done** (110/110, `curation/bounty_decisions.yaml`)
and the frontend dedupe (Phase 6) has **shipped** — the board is 696 → 634.
Phases 1–4 (matcher twin, catalogue builder, generator) are not built yet.

Readable version: https://claude.ai/code/artifact/33a6a180-bee0-4587-bb5a-5d2ea928bc5a

---

## 1. What's wrong

### The board is built from two jobs with opposite constraints

The Aug 1 refresh (`cde9ef3a5`) was **not** a fuzzy title match. It was a scan
against the local MusicBrainz mirror that took the **full outer union** of
several research runs to define the canonical bluegrass catalogue; the board is
the residual after subtracting what the songbook holds.

Those two halves pull in opposite directions:

1. **The union needs the local MB mirror** (a Postgres container on port 5440)
   and can never run in CI — `scripts/lib/CLAUDE.md` already classes MusicBrainz
   work as "Local only", with the established pattern being *run locally →
   commit the cache → CI reads it* (`artist_tags.json`,
   `bluegrass_recordings.json`, `grassiness_scores.json`).
2. **The subtraction needs no MB access at all** and goes stale on every import.

Conflating them is the structural defect. There is no single generator that
could be committed and run — which is why nothing ever was. Seven scripts read
`wanted_songs.json`; nothing builds it.

### Why the two reported entries slipped through

| Wanted entry | What we actually have | Why matching missed it |
|---|---|---|
| `Can the Circle Be Unbroken (By and By)` | `will-the-circle-be-unbroken{,-1,-2}` — all indexed, 3–4 chords | Can ≠ Will → 0.87, below any safe auto-threshold |
| `Pallet on the Floor` | `make-me-a-pallet-on-the-floor` (5 chords), `-on-your-floor` (4), `pallet-on-your-floor` (2) — all indexed | Best-match-only picks the **wrong** candidate: `Carpet on the Floor` scores 0.84, beating every real match |

Both are alias / word-order problems, not threshold-tuning problems. Match on
**candidate sets, never best-match-only** — that inversion is precisely what put
`Carpet on the Floor` ahead of the real Pallet works.

---

## 2. What the evidence rules out

Three plausible fixes were tested against the real data and rejected. Each
rejection narrows what the remaining solution can be.

### Artist-set overlap — circular

MusicBrainz keys recordings by title, so the fragmentation we are fixing
*guarantees* disjoint artist sets. True pairs score 0.00–0.25 Jaccard, false
pairs 0.00–0.07 — overlapping bands. `Sweet Thing`/`Sweet Thang` (true) scores
0.00, identical to `500 Miles`/`900 Miles` (false). Coverage is 257/696.

### MusicBrainz work IDs as a join key — too sparse, and itself fragmented

`bg_query.sql` does select `lrw.entity1 AS work_id`, and the raw export still
exists (`~/workspace/bluegrass_list/bg_coverage.csv.gz`, 75,356 rows) even
though every committed downstream artifact dropped the column. Recovering it
does not help:

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
recordings; `COALESCE(w.name, r.name)` makes work_id → title 1:1 by
construction, so it clusters nothing; and **MusicBrainz fragments the exact
songs in question** — three works for Will/Can the Circle, two for Make Me a
Pallet.

(MB's `l_work_work` relations could cluster some of these, but only within the
21% that have work IDs at all. Worth a look someday; not a foundation.)

### Embeddings on titles — the wrong kind of similarity

Song titles are rigid designators: their identity is conventional, not
compositional, so phrase-meaning similarity is close to orthogonal to song
identity. Embeddings would fix Circle and Pallet while breaking these
*confidently*, which is worse than breaking them noisily:

- `500 Miles` / `900 Miles` — the phrase is `<number> Miles`; numerals embed
  poorly. Different songs.
- `Foggy Mountain Rock` / `Top` / `Breakdown` — three different Flatt & Scruggs
  numbers, near-identical phrases.
- `New Camptown Races` / `Camptown Races` — a Monroe/Wakefield bluegrass
  instrumental versus the Stephen Foster minstrel song.

### What follows

The wanted side carries **only a title**. Lyrics exist on the corpus side alone
— by definition these are songs we lack; zero wanted titles have BL parsed text.
So the identity question is *referential*: which strings denote the same musical
work in this tradition. That is world knowledge, not string distance and not
phrase semantics — and the outer union inherited MB's own fragmentation, so
**song identity is a judgment we have to own**.

---

## 3. Measured scope

696 wanted entries, against the live build (index 2,458 / archive 16,764).

| Class | Count | Notes |
|---|---:|---|
| Resolve to an indexed work at ≥0.93 | 12 | provably spurious |
| Resolve by stopword-free token containment | 17 | `Pallet on the Floor`, `Johnson Boys`, `Grey Eagle` |
| Gray band 0.80–0.93 | 58 | a coin flip — see below |
| Annotation-suffix entries | 38 | `Sally Ann via Tommy Jarrell, mostly 1 & 4` |
| Non-song junk | 4 | `Band Introductions`, `Band Intros`, `Talk`, `Age Bluegrass Album Band` |
| Instrumentals mistyped `Vocal` | 38 | `Clarinet Polka`, `Flatbush Waltz` |
| Thin schema (title/type/source only) | 488 | bare cards, empty artist line |

The gray band cannot be automated at any threshold — true and false pairs
interleave at the same score:

```
0.92  Come All Ye Tenderhearted  ->  Come All You Tender Hearted   TRUE
0.91  Sweet Thing                ->  Sweet Thang                   TRUE
0.89  500 Miles                  ->  900 Miles                     FALSE
0.86  Foggy Mountain Rock        ->  Foggy Mountain Top            FALSE
0.84  Pallet on the Floor        ->  Carpet On The Floor           FALSE
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

---

## 4. Adjudication — done

The real debt was **110 entries, not 696**: only that many have any corpus
candidate at all (fuzzy ≥0.78 or stopword-free token containment). The other
586 are genuinely missing and need no verdict.

All 110 were adjudicated by hand on 2026-08-15 and committed to
`curation/bounty_decisions.yaml`. A batch-API pass was scoped (~$2.71 on Opus 5)
and dropped as over-engineering — the work fit in one sitting.

| Verdict | Board titles | Detail |
|---|---:|---|
| Covered — drop | **53** | 44 ledger keys; 9 are two-title arrangement variants |
| Distinct — keep | 50 | close scores, different songs |
| Uncertain | 7 | needs someone who knows which tune the source meant |
| Not a song | 4 | catalog artifacts; found separately, no candidates |

Reconciles exactly: 53 + 50 + 7 = 110.

Pinning exact board titles during the Phase 6 build (below) later raised the
covered count to 56 — three same-song siblings of already-adjudicated entries
turned up (`Old Mother Flanagan three parts`, `Yellow Rose of Texas, The
Ben/Tommy Jarrell`, `Black Eyed Susie bluegrass version via Vern Williams`).

### Two findings inside the 53

**7 resolve to archived works** — `streamline-cannonball`, `aura-lee`,
`come-all-you-tender-hearted`, `will-you-be-satisfied-that-way`,
`walk-in-the-parlor`, `roxanna-waltz`, `bunch-of-keys`. That is the Dungeon
promote list.

**12 resolve to lyrics-only works** — `sally-ann`, `bill-cheatham`,
`buffalo-gals`, `my-native-home`, `paddy-on-the-turnpike` and others. This is
the double-count: the board advertises them as missing standards while its own
"Needs Chords" section lists the same works.

### Cases only knowledge could settle

- `Feuding Banjos` → `dueling-banjos`. Feudin' Banjos (Smith/Reno, 1955) is the
  original composition later popularized as Dueling Banjos. Scored 0.79 —
  below every threshold.
- `Can the Circle Be Unbroken` → `will-the-circle-be-unbroken`. All three corpus
  works carry the Carter Family lyric, which *is* "Can the Circle Be Unbroken".
  Technically distinct compositions; universally one song in a jam.
- `New Camptown Races` stays on the board despite scoring 0.88 against
  `Camptown Races`.

### Incidental findings

`st-james-infirmary` has `first_line: "EADGBe"` — a tab header leaked into the
lyrics field. Separately, the candidate lists exposed nine **corpus-internal**
duplicate groups the bounty work never touches: Will the Circle ×3, Sitting on
Top of the World ×3, Shady Grove ×3, Streamline/Streamlined Cannonball, Yellow
Rose of Texas ×2. Those belong in `curation/registry.yaml` under `groups:`.

### The archived-coverage hypothesis: negative

Zero archived works title-match a wanted entry at ≥0.93; the 7 confirmed ones
all sit in the gray band. The prune rule and the catalogue agree with each other
— a useful consistency check, not a scandal. The real hidden-coverage bucket is
the **611 indexed works that are lyrics-only** (`has_content: true`,
`chord_count: 0`), largely from `bl_fallback.py` — an import this campaign
itself performed.

---

## 5. The plan

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

This is a *narrowing* tool that proposes candidates. It never decides identity —
that is the ledger's job (Phase 5), because neither string distance nor title
embeddings can do it (see § 2).

### Phase 2 — Catalogue builder (local only, output tracked)

`sources/bounty-hunt/src/build_catalogue.py` — reconstructs and freezes the
outer union that currently exists only as one-off research output.

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

Has to come before any comparison with the corpus. Because the union inherited
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

### Phase 5 — Adjudication ledger (seeded)

`curation/bounty_decisions.yaml` — tracked, permanent, survives regeneration.
Same proven pattern as `sources/bounty-hunt/review_decisions.json` (which
already caught the Xavier Rudd "Stoney Creek" error).

**Keyed on `catalogue_id`, never on a raw title string** — the union's spellings
vary between research runs, so a title-keyed decision silently detaches the next
time the catalogue is rebuilt.

Sections: `covered`, `distinct`, `uncertain`, `not_a_song`, `intra_dupes`, and
`corpus_duplicates_noted` (which feeds `curation/registry.yaml`, not the board).

A `./scripts/utility bounty review | resolve` CLI mirroring the existing
`curate` verbs handles the residual queue. All 110 current candidates are
already resolved; the queue is empty until a research run adds more.

### Phase 6 — Frontend (shipped)

Shipped 2026-08-15. `partitionWanted()` in `docs/js/bounty-view.js` filters the
wanted list at render from two sources: the adjudicated verdicts
(`docs/data/bounty_decisions.json`, lowered from the YAML ledger by
`scripts/lib/bounty_decisions.py` during the index build) and a live
exact/token-set re-check against `allSongs` via the new `docs/js/title-match.js`.
The live pass is what keeps the page honest between builds — a contribution in
`pending_songs` is in `allSongs` before any generator runs again.

`title-match.js` deliberately exposes **no fuzzy ratio**: there is nothing safe
to do with a 0.80–0.93 score, and returning a single best match is what put
`Carpet on the Floor` ahead of the real Pallet works, so it returns candidate
arrays and auto-resolves only exact and token-set matches.

A covered entry whose work is lyrics-only is dropped from "Missing Jam
Standards" but not deleted — `computeChordGaps()` already lists it under
"Needs Chords", and listing it in both places was the double-count. The hint
line under the section reports how many entries were hidden and why.

Type correction ships as a title regex in the emitter (`infer_type`), which
reaches only titles that name their tune form — `Flatbush Waltz` yes,
`Maid Behind the Bar` no. Phase 2 should import that function and extend it
with ledger tags rather than reimplementing it.

**Result: the board goes 696 → 634.** 56 adjudicated titles retire, plus 4 junk
entries, plus 2 the live re-check caught on its own — `Canadian Waltz original
chords` and `Lady of Spain 3/4 time`, whose base titles match the corpus
exactly but which scored below the adjudication threshold in their annotated
form. The self-healing pass earned its place on day one.
(Three more than the ledger's 53: pinning exact titles surfaced
`Old Mother Flanagan three parts`, `Yellow Rose of Texas, The Ben/Tommy Jarrell`
and `Black Eyed Susie bluegrass version via Vern Williams`, all same-song
siblings of entries already adjudicated.)

One thing the build taught us: the ledger originally keyed verdicts by a slug
recomputed from the title, and the keys drifted — `shady-grove` (base song) vs
`shady-grove-minor` (what the slug produces). A prefix fallback then swallowed
the junk entry `Talk` into `talk-about-suffering`. Every covered entry now pins
the exact board titles it retires in a `titles:` list, and
`tests/test_bounty_decisions.py` asserts no title is claimed twice and no junk
title is also covered.

### Phase 7 — Verification

- **pytest**: matcher tiers; catalogue and wanted-list determinism (two runs,
  byte-identical)
- **vitest**: JS matcher parity against the shared fixture
- **Regression guard**: assert `Can the Circle Be Unbroken` and `Pallet on the
  Floor` do not render — the two entries that prompted this work
- **Invariant**: no rendered wanted entry resolves to an indexed work

---

## 6. Order of work

1. ~~**Phase 6 frontend dedupe — ship first.**~~ **Done 2026-08-15.** The
   spurious cards no longer render; the board is 696 → 634.
2. Phase 1 matcher + fixture (unblocks 2–5, testable in isolation). Partly done:
   `docs/js/title-match.js` exists and is tested. Still owed are the Python
   twin (`scripts/lib/title_match.py`) and the shared
   `tests/fixtures/title_match_cases.json` both sides assert against — until
   then the normalization ladder lives in two places
   (`title-match.js` and `bounty_decisions.py`) and can drift.
3. Phase 2 catalogue builder, then Phase 3 dedupe with a real review pass
4. Phase 4 generator, still writing the tracked file (diffable review)
5. Phase 7 tests
6. Flip `wanted_songs.json` to generated + gitignored once CI is verified green
7. Post-merge: promote the 7 confirmed archived works via the Dungeon flow

### One dependency

Archived works the ledger confirms should be restored through the **existing**
promote path — `promoted_songs.json` → hourly sync workflow → build unions it
with registry `keep:` — not a new mechanism. That ships on
`feature/bluegrass-dungeon`, **not yet merged to main**, still needing
`supabase db push` and a live promote test. Only 7 items depend on it, so this
cleanup should not block on the merge.
