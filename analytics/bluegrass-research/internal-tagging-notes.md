# Internal Tagging Notes (Not User-Facing)

This document captures tagging research that may inform backend logic but should NOT be exposed directly to users.

## Why Keep This Internal

The tagging system is already complex:
- MusicBrainz genre tags (Bluegrass, ClassicCountry, Gospel, etc.)
- Harmonic analysis tags (JamFriendly, Modal, Jazzy)
- Source metadata tags

Adding more layers (era tags, composer tags, album-specific tags) increases complexity without necessarily improving user experience.

**Goal**: Use rich internal data to power a *simple* user-facing experience.

## Internal Data We Have

### Artist-Level
- Canonical bluegrass artists (authoritative list)
- Artist name aliases/normalization
- Artist → Era mapping (First Generation, Folk Revival, etc.)

### Song-Level
- Composer credits (can identify Bill Monroe songs covered by others)
- Album-based classification (Dolly's bluegrass trilogy)
- Cover/version relationships (same song, different artists)

### Computed
- Chord complexity (JamFriendly detection)
- Modal characteristics (bVII chord presence)
- Repertoire overlap (graph-based discovery)

## How This Should Be Used

Instead of exposing tags like `era:FirstGeneration` or `composer:BillMonroe`, use this data to:

1. **Power curated collections** - "Bluegrass Standards" uses internal logic, user sees simple collection
2. **Improve search ranking** - Songs from canonical artists rank higher for bluegrass queries
3. **Generate recommendations** - "If you like X, try Y" based on repertoire overlap
4. **Build landing page sections** - Pre-computed queries, not dynamic tag filters

## Files Reference

- `artist_aliases.py` - Artist normalization, canonical lists, album mapping
- `expand_bluegrass_corpus.py` - Graph-based discovery
- `analyze_bluegrass_corpus.py` - Era analysis
- `tagging-improvement-analysis.md` - Technical analysis of tagging gaps

These are internal tools. The landing page should present curated experiences, not tag browsers.
