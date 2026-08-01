# Canonical Jammable Bluegrass — Findings & Index-Prune Write-Up

*Session date: 2026-07-23. Companion to `HANDOFF.md` (which describes the original
brief). This document records what was actually built, what the data showed, the
decisions made and why, and what's left to do.*

---

## 1. What was built

The handoff pipeline was run end-to-end locally against the full MusicBrainz mirror,
then extended into a comparison against the live bluegrassbook.com corpus.

**Pipeline (all local, ~5 min end to end):**

```bash
cd ../music_brainz/mb-db && ./scripts/db start   # container musicbrainz-db, host port 5440
cd ../bluegrass_list
bash run_export.sh                               # -> bg_coverage.csv.gz  (75,356 rows)
.venv/bin/python score_and_build.py              # -> Bluegrass_Jam_Final.xlsx
```

> **Note:** system Python is PEP-668 externally managed — `pip install` fails. Deps live
> in a project-local `.venv`. Always use `.venv/bin/python`.

**Deliverable:** `Bluegrass_Jam_Final.xlsx` — sheets `Jam List`, `Core`, `About`,
styled to match the v1 songbook (header `1F4E2C`, difficulty bands, freeze panes,
autofilter).

| Tier | Count | Rule |
|------|-------|------|
| **Core** | 637 | coverage ≥8 across ≥2 generations **and** touched by a seed-roster artist |
| **Expanded** | 2,134 total | top-2000 by score **∪** all 481 v1 curated songs |

---

## 2. Method — cover coverage as a jamability proxy

A song's jamability tracks **how many distinct bluegrass-family artists, across how many
generations, recorded the same composition**. Standards get cut by every generation;
one-off album tracks don't.

- `Coverage` = distinct bluegrass-family artists who recorded the song
- `Generational Spread` = how many of 3 eras (1 = Monroe/Stanley, 2 = newgrass, 3 = modern)
- `Score` = Coverage × (1 + 0.5 × (Spread − 1))

### Two corrections made to the original handoff design

1. **Songs are folded by normalized title, not raw `work_id`.** MusicBrainz splits
   standards across multiple `work` entries — there were two separate "Little Maggie"
   works (coverage 52 and 8) and two "Nine Pound Hammer". Work-id grouping fragmented
   coverage and duplicated rows. Title-folding reunites them and yields true coverage.
   *(375 fragmented rows collapsed; 322 normalized titles were affected.)*

2. **The deliverable is a strict superset of the v1 481.** All graph-matched v1 songs are
   forced into Expanded regardless of coverage; the 14 v1 songs the genre-filtered graph
   never saw are appended with `Coverage = 0` and noted `v1-curated`. Those 14 *do* exist
   in MusicBrainz — their recording artists simply aren't bluegrass-*tagged* (e.g. "Old
   Slew Foot" has 144 recordings), so they were filtered out upstream.

### Calibration
Of the 481 v1 known-jammable songs, **467 matched the graph**. Their coverage percentiles:
10th = 2, 25th = 4, **median = 9**, 75th = 18. Core's ≥8 threshold therefore sits just
below the median of known-jammable songs — deliberately tight.

---

## 3. The site corpus

| Thing | Where |
|---|---|
| Work files | `../bluegrassbook.com/main/works/` — 18,205 dirs, each `work.yaml` + `lead-sheet.pro` |
| **Search index (source of truth for filters)** | `../bluegrassbook.com/main/docs/data/index.jsonl` — 18,204 entries |
| Collection definitions | `../bluegrassbook.com/main/docs/js/collections.js` |
| Extra tag sources | `docs/data/llm_tags.json`, `docs/data/tag_overrides.json` |

> **Gotcha:** `work.yaml` tags are only a *subset* of searchable tags. LLM-generated and
> override tags live in `index.jsonl`. Counting tags from `work.yaml` gives wrong answers
> (e.g. `BluegrassStandard` appears 0 times there but 236 times in the index).

Site filters: **"All Bluegrass"** = `tag:Bluegrass` (1,373 works) · **"Bluegrass
Standards"** = `tag:BluegrassStandard` (236 works). Also: `JamFriendly` 14,556,
`ClassicCountry` 14,953.

---

## 4. Findings

### 4.1 Content gaps — what the site is missing
Coverage of the canonical list by the site (exact-title → token-fuzzy match):

- **Core tier: 74% → 87% present**
- **Full list: 54% → 76% present**
- **~515 canonical jam songs genuinely missing** (82 of them Core)

Missing rate **by type** — the gap has a clear shape:

| Type | Missing |
|---|---|
| Instrumental | **39%** |
| Fiddle Tune | **32%** |
| Old-Time | 25% |
| Vocal | 24% |
| Gospel | 8% |

**Why:** the corpus was built largely from a classic-country *lyrics/lead-sheet* import,
so songs with no lyrics — the instrumental and fiddle-tune jam canon — were never
imported. Verified truly absent (not renamed): Cumberland Gap, Katy Hill, Cotton-Eyed Joe,
Muleskinner Blues, Sweet Georgia Brown, Jesse James, Bill Cheatham, Rawhide, Lee Highway
Blues, Dusty Miller, Chicken Reel, Billy in the Low Ground, Under the Double Eagle.

### 4.2 The existing filters vs. independent research

**"Bluegrass Standards" (236) — well curated ✅**
Median coverage 11; 75% have ≥5 bluegrass recorders, 59% have ≥8, only 3 have zero
footprint. Independently validated. *But* ~41 (≈17%) are country/pop mis-tags by the LLM
tagger (Your Cheatin' Heart, Big Iron, Lucille, Galveston, Stand by Your Man, The Grand
Tour, Ghost Riders in the Sky…). Both signals agree these don't belong.

**"All Bluegrass" (1,373) — diverges in *both* directions ⚠️**
- *Precision:* median coverage only **2**; **542 (40%) have <2** bluegrass footprint.
- *Recall:* **~1,273 distinct strong songs (coverage ≥8) are NOT tagged `Bluegrass`** —
  John Henry, Orange Blossom Special, Cripple Creek, Nine Pound Hammer, John Hardy,
  I'll Fly Away — filed under `classic-country` / `golden-standard` instead.

**`canonical_rank`** exists on 7,025 indexed works but has **~0 correlation with cover
coverage (Spearman 0.039)** — it measures something else entirely.

**Duplicates:** ~933 duplicate work entries (same song from multiple sources — "Shady
Grove" ×3, "Nine Pound Hammer" ×2).

---

## 5. The index prune

Goal: keep the corpus on disk, but stop indexing songs that aren't jam repertoire.

**Brutality menu** (KEEP if coverage ≥ N):

| Threshold | Keep | Remove |
|---|---|---|
| ≥8 | 1,598 | 16,607 (91%) |
| **≥5 (chosen)** | 4,978 | 13,227 (73%) |
| ≥3 | 7,971 | 10,234 (56%) |
| ≥2 | 10,983 | 7,222 (40%) |
| ≥1 | 16,344 | 1,861 (10%) |

Only **1,861 works (10%) have zero bluegrass footprint** — 90% were touched by at least
one bluegrass artist, so "any footprint" is far too weak a bar for a jam index.

### 5.1 Refining the rule — two rounds of hand-review

**Round 1 — the 59 Standards that ≥5 would have cut.** Split 41 / 16:
- **41 are country/pop mis-tags** → correctly removed (this is the same ~17% precision
  leak noted above).
- **~16 are real bluegrass/old-time that coverage undersells** → protected via a
  whitelist. Coverage's blind spot is **modern songs, gospel, and thinly-recorded
  old-time**: Wagon Wheel (OCMS isn't bluegrass-tagged in MB), I've Got That Old Feeling
  (Krauss), Mighty Dark to Travel (Monroe deep cut), Deep Elem Blues, Make Me a Pallet on
  Your Floor, I Wish I Was a Mole in the Ground, Down to the River to Pray, Why Me Lord.

**Round 2 — the 233 canonical songs still being cut.** Split **226 KEEP / 7 CUT**.
This round produced the session's most important methodological finding.

### 5.2 ⭐ Key lesson: recording artists beat both coverage and tags

At the margin, **raw MB coverage and the site's genre tags are both unreliable**. The
decisive signal is the deliverable's **`Sample Artists`** field — *which bluegrass artists
actually recorded the song*.

Songs the site tags `HonkyTonk`/`Outlaw`/`ClassicCountry` with coverage 4 turned out to be
core bluegrass once you look at who cut them:

| Song | Recorded by |
|---|---|
| Callin' Baton Rouge | New Grass Revival |
| Whisper My Name | Billy Strings, Sam Bush, Tony Rice |
| Loser | Billy Strings, The Travelin' McCourys |
| Detroit City · Ruby, Don't Take Your Love | Flatt & Scruggs |
| Midnight Flyer · Remembering | Osborne Brothers |
| Pick Me Up on Your Way Down · Only You | Del McCoury |
| The Golden Rocket | Jim & Jesse |
| Foggy River | Bill Monroe, Del McCoury, Ricky Skaggs |

**Only 7 of the 233 were genuine cuts** — holiday/novelty/other-genre, where even a Monroe
or Del McCoury recording is a one-off gag rather than jam repertoire:

> Happy Birthday · Rudolph the Red Nosed Reindeer · Let It Snow · I'm My Own Grandpa ·
> Johnny B. Goode · Ain't Misbehavin' · The Great Pretender

*If the corpus is ever re-tagged, prefer a "who recorded this" join over a genre-label
heuristic.*

### 5.3 Final rule and result

> **KEEP if** `mbcov ≥ 5` **OR** on the 16-song blind-spot whitelist **OR**
> (in the canonical list **AND** not one of the 7 novelties).

| | Count |
|---|---|
| **KEEP** | **5,265** |
| **REMOVE** | **12,939 (71%)** |

Progression as the rule tightened: pure ≥5 → 4,977 keep · +blind-spot whitelist → 4,998 ·
+226 verified canonical → **5,265**.

---

## 6. File inventory

**Deliverables**
| File | Contents |
|---|---|
| `Bluegrass_Jam_Final.xlsx` | The canonical songbook — Jam List (2,134), Core (637), About |
| `index_removal_FINAL.csv` | **All 18,204 works with a `decision` column** — drives the index change |
| `index_removal_FINAL_REMOVE_only.csv` | Just the 12,939 to drop |

**Analysis / audit trail**
| File | Contents |
|---|---|
| `gap_missing_from_site.csv` | 515 canonical songs missing from the site (content backlog) |
| `recon_bluegrass_untagged_strong.csv` | ~1,273 strong songs the `Bluegrass` tag misses (promote) |
| `recon_bluegrass_tag_weak.csv` | 542 weak songs wrongly tagged `Bluegrass` (demote) |
| `standards_below_keep5_labeled.csv` | The 59 Standards, labeled 41 CUT / 16 KEEP |
| `canonical_233_final_verdicts.csv` | The 233, labeled 226 KEEP / 7 CUT |
| `site_index_scored.csv` | Every indexed work + coverage + tags |
| `site_works.csv`, `site_tags.csv` | Raw extractions from `work.yaml` |

**Intermediates:** `bg_coverage.csv.gz` (the export), `work_typesig.csv.gz` (per-work
instrumental/gospel tag signal — sparse, only ~206 works), `export_log.txt`.

---

## 7. Open items / next steps

**Index changes (ready to apply, not yet applied)**
1. Apply `index_removal_FINAL.csv` — as an `indexed: false` flag in `work.yaml`, or a
   drop-list the build reads. *Nothing has been written to the site repo.*
2. **`BluegrassStandard` tag correction** — drop the 41 country mis-tags. Clean,
   self-contained win independent of the prune.
3. **`Bluegrass` tag expansion** — promote the ~1,273 strong-but-untagged songs.
4. **Dedup** the ~933 duplicate work entries.

**Content**
5. Fill the instrumental/fiddle-tune gap from `gap_missing_from_site.csv` — highest-value
   missing standards are listed in §4.1.

**Pipeline hygiene**
6. `score_and_build.py`'s `JUNK` regex misses `"introduction"` (matches only `\bintro\b`),
   so live-album track names leak in — "Introduction" scored coverage 33. ~7 junk rows
   total. Scrub and regenerate.
7. Consider refining generation inference via each work's earliest/latest release year
   rather than artist `begin_date_year`, which is noisy (person = birth year, band =
   formation year).

**Known limitations**
- Coverage counts *bluegrass-family-tagged artists only* — it systematically undersells
  modern songs, gospel, and thinly-recorded old-time (see §5.2).
- Fuzzy title matching rescues near-misses but can produce occasional false matches on
  generic one-word titles.
- `Type` for graph-only songs is heuristic (title keywords + a sparse MB tag signal).
