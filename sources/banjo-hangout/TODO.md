# Banjo Hangout Import - Outstanding Issues

## Critical: Provenance Tracking Gap

**Problem**: Downloaded TEF files only have BH ID (e.g., `1687.tef`) with no metadata linking them to:
- The work slug in `works/`
- The original BH metadata (title, author, genre, style)
- Version info (BH has multiple tabs of the same song)

**Solution needed**:

1. **In work.yaml** - store source_id:
```yaml
parts:
  - type: tablature
    instrument: banjo
    format: otf
    file: banjo.otf.json
    provenance:
      source: banjo-hangout
      source_id: "1687"              # BH tab ID - REQUIRED
      source_url: https://www.banjohangout.org/tab/1687
      author: "TabAuthor"
      imported_at: "2025-01-03"
```

2. **Mapping file** - `sources/banjo-hangout/import_mapping.json`:
```json
{
  "1687": {
    "work_slug": "red-haired-boy",
    "bh_title": "Red Haired Boy",
    "bh_author": "SomeUser",
    "imported_at": "2025-01-03",
    "status": "imported"
  }
}
```

3. **Catalog with metadata** - `tab_catalog.json` should store BH metadata at scan time

## Known Parsing Issues

### FIXED: Measure 11 Extra Notes (Red Haired Boy - ID 1687)
- **Root cause**: Chord diagram notes with 'D' marker and effect2=0x07 weren't filtered
- **Fix**: Added filtering in `reader.py` for:
  - 'D' marker notes (in addition to 'C')
  - Notes with effect2=0x07 (chord overlay indicator even with marker='F')
- Re-converted and verified measure 11 now has correct notes

### Backup Tracks Not Working
- Guitar and bass tracks exist in OTF but not rendering/playing properly
- **Symptoms**: Only banjo track renders, guitar/bass are silent or invisible
- **Files to check**:
  - `docs/js/work-view.js` - track selection logic
  - `docs/js/renderers/tablature.js` - multi-track rendering
  - `docs/js/renderers/tab-player.js` - multi-track playback
- **Debug**: Check OTF has guitar/bass tracks: `python3 -c "import json; d=json.load(open('works/red-haired-boy/banjo.otf.json')); print(list(d['notation'].keys()))"`
- Expected output: `['banjo', 'guitar', 'bass']`

## Completed Fixes (This Session)

1. **Articulation detection** - direction-based h/p in `otf.py`
2. **Ghost note filtering** - effect1 = 0x0e/0x0f
3. **Chord diagram filtering** - 'C' marker notes
4. **Slur rendering** - fixed in `tablature.js`
5. **Triplet timing** - 'K' marker → 80-tick spacing
6. **Triplet engraving** - beam + "3" bracket in `tablature.js`

## Next Steps

1. Design and implement provenance tracking (mapping file + work.yaml updates)
2. Re-download 1687.tef with proper method (check scraper.py for correct URL)
3. Debug measure 11 parsing issue
4. Fix backup track rendering
5. Test full pipeline: scan → download → convert → import with provenance

## Version Tracking

BH has multiple versions of the same song. We need to:
- Track which BH tabs map to which work
- Support multiple tablature parts per work (different arrangements)
- Use `version_label` in provenance for different arrangements

```yaml
parts:
  - type: tablature
    instrument: banjo
    file: banjo-scruggs.otf.json
    provenance:
      source_id: "1687"
      version_label: "Scruggs Style"
  - type: tablature
    instrument: banjo
    file: banjo-melodic.otf.json
    provenance:
      source_id: "2345"
      version_label: "Melodic Style"
```
