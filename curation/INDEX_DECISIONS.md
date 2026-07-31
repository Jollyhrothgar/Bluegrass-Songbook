# Index Decisions — why search shows what it shows

Decision record for the searchable-index curation. Written so a fresh session
(or a new machine) can reconstruct every decision from files in THIS repo.

## The policy (Mike, 2026-07-31)

The searchable index is deliberately **bluegrass + bluegrass-adjacent** (~1,800
songs). The full 18,500+ work archive is kept: every work still resolves at
`#work/{slug}`, stays in user lists, and can be restored to search at any time.
Nothing was deleted. The intent is a jam songbook, not a country lyrics site —
but the door stays open to widen the index later.

## How a row gets hidden

`scripts/lib/build_works_index.py` → `curation.apply_index_prune()` stamps
`indexed: false` on rows whose id is in `curation/index_prune.csv`, UNLESS:
- the work is user-origin (`USER_SOURCES` in `scripts/lib/curation.py`, or has
  `submitted_by`) — user contributions are never pruned; or
- the work has a `keep:` entry in `curation/registry.yaml`.

Frontend: search/collections/bounty filter on `indexed !== false`.

## Decision history

### Wave 1 — 2026-07-23 coverage prune (rows with numeric third column)

Rule: REMOVE if fewer than 5 bluegrass-family artists ever recorded the title
(`mbcov < 5`), minus a 16-song whitelist and 226 verified canonicals.
18,204 works → 5,265 kept.

**Where mbcov came from (and its known flaw):** a SQL query against a local
MusicBrainz PostgreSQL dump counting distinct recordings of each title by a
curated roster of bluegrass-family artists. Titles were fuzzy-matched, which
INFLATED coverage for country songs whose titles contain a standard's title
("She Sang Amazing Grace" inherited Amazing Grace's 57). This is why wave 2
was needed.

Evidence vendored into this repo (originals lived in the untracked local
workspace `~/workspace/bluegrass_list/` — do not rely on that surviving):
- `curation/analysis/FINDINGS.md` — full methodology + results (§5.3 = the rule)
- `curation/analysis/bg_query.sql` — the exact coverage SQL
- `curation/analysis/run_export.sh` — the export driver
- `curation/analysis/site_index_scored.csv` — **the frozen per-work snapshot**
  (`id,title,source,nt,bg,std,crank,tags,mbcov`) used for the decisions.
  Use THIS for any future analysis; regeneration is optional, not required.

Regenerating from scratch (optional) needs the local MusicBrainz DB documented
in the root `CLAUDE.md` § "Refreshing MusicBrainz Tags" (a separate repo at
`music_brainz/mb-db`, PostgreSQL on port 5440 — local-only, not in CI).

### Wave 2 — 2026-07-31 ledger convergence ('ledger-cleanup' rows)

Directive: converge on the intersection of three independent canons, softened
to "any two signals" so instrumentals survive (BluegrassLyrics is vocals-only).
KEEP if any of:
- **two of three ledgers** list the title:
  1. MB coverage (= survived wave 1),
  2. Strum Machine catalog — reconstructed in-repo from
     `docs/data/strum_machine_cache.json` (real matches only; most entries are
     `_no_match` markers) ∪ `docs/data/sm_missing_vocals.json`
     (833 SM vocal songs we lacked, diffed Feb 2026). The full SM scrape was
     never saved; this union (~1,292 titles) is the best in-repo record.
  3. BluegrassLyrics.com — titles in `sources/bluegrass-lyrics/parsed/*.json`;
- instrumental jam canon: `sources/tunearch/src/tune_list.py` match, or the
  work has a tablature part or ABC content;
- artist credit in `docs/data/bluegrass_artist_database.json` (299 curated);
- user-origin source; or already Strum-Machine-linked.

Result: 5,464 searchable → 1,458. 121 previously-pruned works rescued where
SM and/or BL vouched for them (registry `keep:` with reasons).

### Wave 3 — 2026-07-31 manual review (registry keep: entries)

Every one of the 4,124 wave-2 pruned titles was read by Claude; 163 rescued
(commit `bedf9c5ce` groups them by category). Systematic misses this exposed —
**check these before trusting any future automated pass**:
- the 299-artist database LACKS: Easter Brothers, The Isaacs, Reno & Smiley,
  Reno Brothers, Jim & Jesse, Dailey & Vincent, IIIrd Tyme Out, Larry Sparks,
  Carl Story, Hylo Brown, Paul Williams, Country Gentlemen, Osborne Brothers,
  Bluegrass Album Band, High Country, Johnny & Jack, Louvin/Delmore Brothers;
- artist-string variants defeat matching ("J. D. Crowe" vs "J.D. Crowe",
  "Earl Scruggs and Lester Flatt" for Flatt & Scruggs);
- title variants defeat ledger matching ("I'm A Man of Constant Sorrow",
  "Salty Dog Blues" vs "Salty Dog", "...Lyrics and Chords" filename debris).

Final searchable count after all waves: **1,766** (plus later additions).

## Putting songs back

```bash
# one song
./scripts/utility curate unprune <work-id> --reason "why it belongs"
./scripts/bootstrap --quick

# a category (example: everything by an artist, or mbcov >= 10)
# filter curation/analysis/site_index_scored.csv for the ids, remove those
# rows from curation/index_prune.csv (or add keep: entries), rebuild.
```

Widening the whole policy later = pick a looser rule, regenerate
`index_prune.csv` from the vendored snapshot + the ledgers above. All inputs
are in-repo; nothing depends on the machine this was first done on.
