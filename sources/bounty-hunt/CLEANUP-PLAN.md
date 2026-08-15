# Bounty Board Cleanup Plan (Aug 2026)

Make `docs/data/wanted_songs.json` a **derived artifact** with a committed
generator, a durable adjudication ledger for the calls no algorithm can make,
and a self-healing bounty page.

---

## 1. Diagnosis

### Root cause

`docs/data/wanted_songs.json` is a hand-committed snapshot **with no generator
in the repo**. Seven consumers read it — `ug_scrape.py`, `bl_fallback.py`,
`tef_bounty.py`, `mcb_fetch.py`, `tunearch_bounty.py`,
`mandozine/import_bounty.py`, `docs/js/bounty-view.js` — and nothing builds it.
The last refresh (`cde9ef3a5`, 2026-08-01, "fuzzy title matching") was done by a
script that was never committed, so the list cannot be re-derived or
re-verified. `bounty-view.js` renders it with zero cross-checking against the
live index, so it drifts the moment anything is imported.

### Why the reported entries slipped through

| Wanted entry | What we actually have | Why matching missed it |
|---|---|---|
| `Can the Circle Be Unbroken (By and By)` | `will-the-circle-be-unbroken{,-1,-2}` — all indexed, 3–4 chords | Can ≠ Will → 0.87, below any safe auto-threshold |
| `Pallet on the Floor` | `make-me-a-pallet-on-the-floor` (5 chords), `make-me-a-pallet-on-your-floor` (4), `pallet-on-your-floor` (2) — all indexed | Best-fuzzy-match picks the **wrong** candidate: `Carpet on the Floor` scores 0.84, beating every real match |

Both are alias / word-order problems, not threshold-tuning problems. This is the
single most important design constraint: **string similarity alone provably
cannot finish this job.**

### Measured scope (696 entries, against index 2,458 / archive 16,764)

| Class | Count | Notes |
|---|---:|---|
| Resolve to an indexed work at ≥0.93 | 12 | provably spurious |
| Resolve by stopword-free token containment | 17 | e.g. `Pallet on the Floor`, `Johnson Boys`, `Grey Eagle` |
| Gray band 0.80–0.93 | 58 | needs human adjudication (see below) |
| Annotation-suffix entries | 38 | `Sally Ann via Tommy Jarrell, mostly 1 & 4`, `Cotton-Eyed Joe 16 bars` |
| Non-song junk | 4 | `Band Introductions`, `Band Intros`, `Talk`, `Age Bluegrass Album Band` |
| Instrumentals mistyped as `Vocal` | 38 | `Clarinet Polka`, `Flatbush Waltz`, `Maid Behind the Bar` |
| Thin schema (title/type/source only) | 488 | render as bare cards with an empty artist line |

The gray band is a coin flip and must not be automated:

```
0.92  Come All Ye Tenderhearted  -> Come All You Tender Hearted   TRUE
0.91  Sweet Thing                -> Sweet Thang                   TRUE
0.89  500 Miles                  -> 900 Miles                     FALSE
0.86  Foggy Mountain Rock        -> Foggy Mountain Top            FALSE
0.84  Pallet on the Floor        -> Carpet On The Floor           FALSE
```

### Two upstream mechanisms found

1. **Annotation suffixes come from Strum Machine.** `strum_machine_cache.json`
   entries carry a `label` field (`"4/4 version"`). SM's catalog listing glues
   the variant label into the display name, and `sm_missing_vocals.json` (832
   bare title strings) inherited it verbatim. This is also the source of the
   intra-list duplicates — Shady Grove ×2, Cotton-Eyed Joe ×2, Sweet Sunny
   South ×2, Another Day Another Dollar ×2.
2. **The thin half is all one source.** All 488 `wanted_source: strum-machine`
   entries are blanket-typed `Vocal` (the ledger filename says "vocals"), which
   is why the fiddle-tune bounties render under "More Songs" with no instrument
   chips — `bounty-view.js` routes purely on `type`. `core` also collapsed
   82 → 19 because the Aug 1 refresh dropped rich fields instead of preserving
   them.

### Archived-coverage hypothesis: negative, with a better finding next door

**Zero archived works title-match a wanted entry at ≥0.93.** The gray band holds
~6 plausible ones (`Come All You Tender Hearted`, `Sweet Thang`, `Roxanna
Waltz`, `Bunch of Keys`, `Aura Lee`, `Come Along John`). The prune rule and the
wanted-list ledgers agree with each other — a useful consistency check, not a
scandal.

The real hidden-coverage bucket is **611 indexed works that are lyrics-only**
(`has_content: true`, `chord_count: 0`), largely from `bl_fallback.py` — an
import the bounty campaign itself performed. Wanted entries resolving onto them
include `sally-ann`, `my-native-home`, `bill-cheatham`, `buffalo-gals`,
`the-bluest-man-in-town`, `paddy-on-the-turnpike`. **The board advertises these
as "Missing Jam Standards" while its own "Needs Chords" section lists the very
same works.** That double-count is the most visible symptom to fix.

---

## 2. Plan

### Phase 1 — Shared title matcher

`scripts/lib/title_match.py` + `docs/js/title-match.js`, driven off one shared
fixture so the two implementations cannot drift:

- `tests/fixtures/title_match_cases.json` — `(a, b, expected_class)` triples,
  asserted by **both** pytest and vitest.

Normalization ladder:

1. NFKC, lowercase, curly → straight quotes
2. Strip annotations: ` via …`, trailing `modal|major|minor`, `w/…`,
   `N bars`, `N/N time`, `(…)` parentheticals
3. `&` → `and`, drop punctuation, collapse whitespace
4. Normalize articles at **both** ends — the data contains the trailing form
   (`Last Song, The`, `Mountain House, The`, `Bluest Man in Town, The`)
5. Tiers: exact-normalized → **auto**; token-set equality → **auto**;
   fuzzy ≥0.93 → **auto**; token-set containment → **queue**;
   0.80–0.93 → **queue**; below → miss

Match against **candidate sets, never best-match-only** — that inversion is
exactly what put `Carpet on the Floor` ahead of the real Pallet works.

### Phase 2 — Generator

`sources/bounty-hunt/src/build_wanted.py`

**Inputs** (all already in-repo):

| Ledger | File | Contributes |
|---|---|---|
| Strum Machine missing | `docs/data/sm_missing_vocals.json` | titles (split label off, collapse variants) |
| MB cover-coverage | `curation/decision-data/site_index_scored.csv` | `coverage`, `core` |
| MB recordings | `docs/data/bluegrass_recordings.json` | `artists` |
| BluegrassLyrics | `sources/bluegrass-lyrics/parsed/` (1,818) | unimported vocals |

**Subtract** current coverage: `docs/data/index.jsonl` + `archive.jsonl` +
`works/`, via the Phase 1 matcher, with the Phase 3 ledger overriding both ways.

**Type inference** replacing the blanket `Vocal`: ledger tags → title regex
(`waltz|reel|jig|hornpipe|breakdown|rag|polka|march|two-step|schottische`) →
BL presence implies vocal. Emits `Instrumental` / `Fiddle Tune` / `Gospel` /
`Vocal`.

**Uniform output schema on every row** — no more two-tier cards:

```json
{
  "title": "Carroll County Blues",
  "type": "Instrumental",
  "wanted_source": ["mb-coverage", "strum-machine"],
  "coverage": 18, "core": true,
  "artists": ["Fred Price", "..."],
  "instruments": ["fiddle", "banjo", "mandolin", "guitar"],
  "key": null, "difficulty": null, "notes": null,
  "variants": ["4/4 version", "modal"]
}
```

Output must be **byte-stable** across runs (sorted keys, sorted rows) — same
determinism bar the index build already holds.

### Phase 3 — Adjudication ledger

`curation/bounty_decisions.yaml` — tracked, permanent, survives every
regeneration. Same proven pattern as `sources/bounty-hunt/review_decisions.json`
(which already caught the Xavier Rudd "Stoney Creek" error).

```yaml
covered:          # wanted title IS this work — drop from the board
  "Can the Circle Be Unbroken (By and By)":
    work: will-the-circle-be-unbroken
    reason: "Same jam tune; Carter Family title variant"
    decided: "2026-08-15"

distinct:         # looks similar, is a different song — keep on the board
  "500 Miles":
    not: 900-miles
    reason: "Hedy West song, unrelated to the 900 Miles fiddle tune"

not_a_song:
  "Band Introductions": { reason: "SM catalog artifact" }
```

CLI mirroring the existing `curate` verbs:

```bash
./scripts/utility bounty review                      # queue + candidates + chord counts
./scripts/utility bounty resolve <title> --covered <work-id> --reason "..."
./scripts/utility bounty resolve <title> --distinct <work-id> --reason "..."
./scripts/utility bounty resolve <title> --not-a-song --reason "..."
```

**Seeding order:** 29 provable + 4 junk + 38 annotation collapses first (bulk,
mechanical), then work the ~58 gray band by hand.

### Phase 4 — Frontend

`docs/js/bounty-view.js`:

- Import the shared matcher; filter `wantedSongs` against `allSongs` **at
  render**. This keeps the page honest between builds, when user contributions
  land in `pending_songs` and the static JSON can't know.
- Split the outcome rather than just dropping: match **with chords** → drop
  entirely; match **lyrics-only** → route into "Needs Chords", deduped against
  the existing `computeChordGaps()` list so it doesn't double-render.
- Section routing then reads the corrected `type`, so fiddle-tune bounties
  finally land under instrumentals with their instrument chips.

### Phase 5 — Verification

- **pytest**: matcher tiers; generator determinism (two runs, byte-identical)
- **vitest**: JS matcher parity against the shared fixture
- **Regression guard**: assert `Can the Circle Be Unbroken` and `Pallet on the
  Floor` do not render on the board — the two entries that prompted this work
- **Invariant test**: no rendered wanted entry resolves to an indexed work

### Phase 6 — Tier bookkeeping

Per the decision to make this build output (matches the repo rule, *"if a build
produces it, git doesn't track it"*):

- Add `docs/data/wanted_songs.json` to `.gitignore`
- Generate it in `scripts/bootstrap` **and** `.github/workflows/build.yml`,
  before the index build and before the `docs/` upload
- **Verify before flipping**: the four `process-*.yml` automations must not
  read the file without generating it first (the scraper scripts run locally,
  but this needs confirming, not assuming)
- Update the Data Tiers table in `CLAUDE.md`

---

## 3. Dependency: the Dungeon promote flow

Any archived work the Phase 3 ledger confirms as real coverage should be
restored through the **existing** promote path, not a new mechanism:
`promoted_songs.json` → hourly sync workflow → build unions it with registry
`keep:`.

That ships on `feature/bluegrass-dungeon`, which is **not yet merged to main**
and still needs `supabase db push` plus a live promote test. Roughly 6
candidates depend on it — small enough that this cleanup should not block on the
merge. Sequence it after.

---

## 4. Suggested execution order

1. Phase 1 matcher + fixture (unblocks everything, testable in isolation)
2. Phase 4 frontend dedupe — **ship early**; the spurious cards stop rendering
   immediately, independent of the generator
3. Phase 2 generator, still writing the tracked file (diffable review pass)
4. Phase 3 ledger: bulk seed, then the gray band
5. Phase 5 tests
6. Phase 6 flip to generated + gitignored, once a full CI run is verified green
7. Post-merge: promote the confirmed archived works via the Dungeon flow
