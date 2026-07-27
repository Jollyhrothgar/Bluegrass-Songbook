---
name: tab-debug
description: TEF/tablature debugging for parsing issues, missing notes, wrong articulations, tuning problems. Use when debugging banjo tabs from Banjo Hangout or other TEF sources.
---

# Tab Debugging Skill

Use this skill when debugging tablature parsing, rendering, or playback issues for TEF (TablEdit) files.

## When to Use

- User reports a tab is rendering incorrectly
- Notes are missing, duplicated, or in wrong positions
- Articulations (slides, hammer-ons, ties) aren't showing
- Playback timing is wrong
- Tab shows blank/empty

## Debugging Workflow

### 1. Get the source info from work.yaml

```bash
cat works/{work-slug}/work.yaml | grep -A5 provenance
```

Look for:
- `source_id` - the BH tab ID
- `source_url` - download URL for TEF file

### 2. Re-download the TEF file if needed

```bash
curl -L -o sources/banjo-hangout/downloads/{id}.tef "{source_url}"
```

### 3. Parse and inspect the TEF file

```python
import sys
sys.path.insert(0, 'sources/banjo-hangout/src')
from tef_parser.reader import TEFReader
from tef_parser.otf import tef_to_otf
from pathlib import Path

reader = TEFReader(Path('sources/banjo-hangout/downloads/{id}.tef'))
tef = reader.parse()

# Basic info
print(f"Format: {'V2' if tef.header.is_v2 else 'V3'}")
print(f"Title: {tef.title}")
print(f"Time sig: {tef.header.v2_time_num}/{tef.header.v2_time_denom}")
print(f"Note events: {len(tef.note_events)}")
```

### 4. Inspect specific measures

Measure N corresponds to positions `(N-1)*16` to `N*16-1`:

```python
def show_measure(tef, measure_num):
    start = (measure_num - 1) * 16
    end = start + 16
    for evt in tef.note_events:
        if start <= evt.position < end:
            result = evt.decode_string_fret()
            if result:
                string, fret = result
                raw = evt.raw_data.hex() if evt.raw_data else 'none'
                print(f'pos={evt.position}, s{string}f{fret}, marker={evt.marker!r}, raw={raw}')

show_measure(tef, 25)  # Check measure 25
```

### 5. Check raw bytes for articulations

For V2 format, the 6-byte note record structure:
```
Byte 0: position (0-255)
Byte 1: string/fret encoded
Byte 2: duration
Byte 3: marker character ('I', 'F', 'L', 'K', etc.)
Byte 4: effect1 (articulations)
Byte 5: effect2 (overlays)
```

```python
for evt in tef.note_events:
    if evt.raw_data and len(evt.raw_data) >= 6:
        effect1 = evt.raw_data[4]
        effect2 = evt.raw_data[5]
        if effect1 or effect2:
            result = evt.decode_string_fret()
            if result:
                print(f's{result[0]}f{result[1]}: effect1=0x{effect1:02x}, effect2=0x{effect2:02x}')
```

### 6. Re-convert and test

```python
otf = tef_to_otf(tef)
Path('works/{work-slug}/banjo.otf.json').write_text(otf.to_json())
# Also update docs for live testing:
Path('docs/data/tabs/{work-slug}-banjo.otf.json').write_text(otf.to_json())
```

## TEF Format Reference

### V2 vs V3 Detection

```python
# V2: starts with printable ASCII, has fixed header structure
# V3: binary format id; 'debt' marker at offset 56 points at components

if tef.header.is_v2:
    # 6-byte note records, positions 0-255 per measure
else:
    # 12-byte component records (see V3 reference below)
```

### V3 Format Reference (2026-07, reverse-engineered on Welcome to New York)

**Header pointer table** (u32 little-endian at fixed offsets):

| Offset | Points at |
|--------|-----------|
| 60 | Component (note) region — same value as the 'debt' pointer |
| 64 / 68 / 72 | Title / subtitle / comments (each u16-len-prefixed) |
| 84 | **Free-text table**: u16 count, then count × [u16 len][bytes, NUL-terminated] |
| 88 | Chord diagram table: u16 entry_size (36), u16 count, then records (name inside) |
| 128 | Reading list: u16 entry_size (32), u16 count, then records |

**Reading-list records** (32 bytes): u16 from_measure, u16 to_measure, then a
NUL-terminated **entry label** ("Intro", "Part A1", ...) — TablEdit prints it
above the range's first measure. Parsed into `reading_list[].name` in OTF.

**12-byte component record** (TuxGuitar TEInputStream layout):

| Bytes | Meaning |
|-------|---------|
| 0-3 | location (u32): `position = loc // (32*total_strings)`, `string_row = (loc % (32*total_strings)) // 8` |
| 4 | component type. Notes: bits 0-4 = fret+1 (0x01-0x19); 0x40 = grace flag. Non-notes below. |
| 5 | notes: duration code (bits 0-4) + dynamics (bits 5-6) + **tie/connect bit (bit 7)**. Text components: 0-based text-table index. |
| 6 | articulation: 1=hammer, 2=pull, 3=slide, **0x0c=bend/choke SOURCE**, 0x0f=dead/muted (chop ×) |
| 10 | **fingering pack, base-6**: `6*pluck + lh_code`. pluck 1..5 = T/I/M/R/P; lh_code 0 = none, else fretting digit = lh_code-1. (0x0a = T + finger 3, 0x0b = T + finger 4.) |

**Non-note component types** (skipped for notes): 0x33, 0x35, 0x36, 0x37,
0x38, 0x39, 0x3D, 0x75, 0x78, 0x7D, 0x7E, 0xB6, 0xB7, 0xBD, 0xBE, 0xFD, 0xFE.
Decoded so far:

| Type | Meaning | Parsed? |
|------|---------|---------|
| 0x39 | **Free-text anchor**: byte 5 = 0-based index into the text table at header ptr 84; location gives (measure, slot, string row) | Yes → OTF `annotations: [{measure, tick, text}]` (byte 7 = signed y-offset, ignored) |
| 0x35 | Chord-diagram anchor (byte 5 = chord index) | Not yet (chord NAME usually also appears as a 0x39 text) |

All of the above oracle-verified against TablEdit's own MusicXML export
(`<words>`, `<pluck>`, `<fingering>`, `<harmony>`): 35/35 text placements and
37/37 fingerings match on Welcome to New York.

### Marker Types (V2 byte 3)

| Byte | Char | Meaning | Action |
|------|------|---------|--------|
| 0x49 | 'I' | Initial/melody note | Keep |
| 0x46 | 'F' | Fret/melody note | Keep |
| 0x4C | 'L' | Legato (hammer/pull) | Keep, check direction for h/p |
| 0x4B | 'K' | Triplet note | Keep, apply triplet timing |
| 0x43 | 'C' | Chord diagram | **SKIP** |
| 0x44 | 'D' | Diagram overlay | **SKIP** |
| 0x40 | '@' | Alternate/chord tone | Heuristic: keep highest fret only |

### Effect1 Byte (V2 byte 4) - Articulations

| Value | Meaning |
|-------|---------|
| 0x00 | No effect |
| 0x01 | Hammer-on or pull-off (check fret direction) |
| 0x02 | Unknown (possibly slide related) |
| 0x03 | Slide (bits 0x01 + 0x02 both set) |
| 0x04 | Bend (1/4 step) - NOT legato, ignore |
| 0x80 | Tie to previous note |

### Effect2 Byte (V2 byte 5) - Overlays

| Value | Meaning |
|-------|---------|
| 0x07 | Chord overlay - **SKIP this note** |

### Tie Detection

Ties use the 0x80 bit in the marker byte:
```python
def is_tie(evt):
    if evt.raw_data and len(evt.raw_data) >= 4:
        marker_byte = evt.raw_data[3]
        return bool(marker_byte & 0x80)
    return False
```

### Slide vs Hammer-on Detection

```python
def get_articulation(evt):
    if evt.raw_data and len(evt.raw_data) >= 5:
        effect1 = evt.raw_data[4]
        if effect1 == 0x03:  # Both bits set = slide
            return '/'
        elif effect1 == 0x01:  # Just bit 0 = legato
            # Check direction for h vs p
            return 'h' if going_up else 'p'
    return None
```

## Common Issues & Fixes

### Empty notation (0 events)

**Cause**: V3 format variant without 'debt' chunk marker
**Status**: Unsupported - these files use a different V3 sub-format
**Check**: `conversion_log.json` shows "Empty notation (0 events) - format: v3"

### "Cannot read properties of undefined (reading 'id')"

**Cause**: TEF file has no instrument definitions, so `otf.tracks` is empty
**Fix**: Added default "banjo" track creation in `otf.py` when no instruments detected
**Applied**: 2026-01-04 - if you see this error, re-run batch_convert.py

### Extra notes appearing

**Cause**: Chord diagram notes ('C', 'D' markers) or overlay notes (effect2=0x07) not filtered
**Fix**: Check marker filtering in `reader.py`

### @ marker notes cluttering tab

**Cause**: '@' markers are alternate voicings/chord tones
**Fix**: Heuristic in reader.py keeps only highest fret at each position when no melody markers present

### False legato/hammer-ons on every note

**Cause**: V2 TEF files use marker='L' for "lead/melody note", not "legato"
**Symptom**: Every note shows hammer-on slur
**Fix**: Don't check marker='L' for articulation - only use effect1 bytes:
- `has_legato_effect()` - check `effect1 & 0x07` only
- `technique_from_event()` - removed marker='L' check
**Files**: `sources/banjo-hangout/src/tef_parser/otf.py`

### Wrong fret on notes with text annotations

**Cause**: V2 format uses bit 5 of fret byte + effect2 for high frets, but annotations also set bit 5:
- effect2=0x06: text annotation
- effect2=0x07: chord overlay
- effect2=0x0c: fingering annotation

**Symptom**: Random notes have wrong fret (e.g., fret 12 instead of fret 0)
**Fix**: Only add effect2 to fret when effect2 > 0x0c (not a special marker):
```python
effect2_val = rec[5] if len(rec) > 5 else 0
if (fret_byte >> 5) & 0x01 and effect2_val > 0x0c:
    fret += effect2_val
```
**Files**: `sources/banjo-hangout/src/tef_parser/reader.py` line ~1013

### Multi-track TEF files show all tracks merged onto one

**Cause**: Instrument names with embedded tuning (e.g., "Mandolin GDAE" instead of "Mandolin\x00GDAE") not parsed
**Symptom**: Header says N tracks/M strings, parser finds fewer instruments
**Debug**: Check `tef.header.v2_tracks` vs `len(tef.instruments)` - they should match
**Fix**: Add patterns for combined instrument+tuning names in `parse_instruments()`:
```python
instrument_patterns = [
    (b"Mandolin GDAE", 4),
    (b"Mandolin Standard", 4),
    (b"Mandolin", 4),
    ...
]
```
**Files**: `sources/banjo-hangout/src/tef_parser/reader.py` line ~960

### Bends showing as pull-offs

**Cause**: effect1=0x04 was incorrectly interpreted as "explicit pull-off"
**Symptom**: Notes with 1/4 step bends show pull-off slurs
**Fix**: Removed 0x04 from legato detection - it's actually a bend indicator

### Bends/chokes: DECODED (2026-07) via the connect bit, not the noisy 0x04 bit

**Status**: bends ARE decoded and rendered. Detection (`bend_destination_keys`
in otf.py, both parsers): a note carrying the tie/connect bit (V2 dyn bit-7 /
V3 byte-5 bit-7) whose fret CHANGED vs the previous note on that string, with
no h/p/slide, is a bend/choke TARGET → `tech: 'b'`, `tie: false`. In V3 the
SOURCE note additionally carries byte6 = 0x0c (corroboration, not required).

- **Render** (tablature.js): TablEdit's glyph — tilted-up arrow from the
  source note to the bracketed `[target]` fret, amount ("½") above the tip.
- **Playback** (tab-player.js): `bendWaypoints`, quarter-tone choke
  (`BEND_SEMITONES = 0.5`). Fuller +1-semitone glide is issue #184.

**Old caution still true**: the raw V2 `effect1 & 0x04` bit is NOISE (fires on
~2,221 corpus notes; TablEdit's MusicXML has 0 `<bend>` elements there). Do
not decode 0x04 → bend.
- `has_legato_effect()` uses `effect1 & 0x03` (not 0x07)
- `technique_from_event()` doesn't check 0x04
**Files**: `sources/banjo-hangout/src/tef_parser/otf.py`, `docs/js/tef-import/otf.js`

### Wrong articulation (slide showing as hammer)

**Cause**: effect1=0x03 (slide) being detected as 0x01 (hammer)
**Fix**: Check slide first in `compute_articulations()` in otf.py

### V2 reading list (repeats) not showing

**Cause**: V2 reading list wasn't being parsed
**Symptom**: Song plays through once without repeats
**Fix**: Added `parse_reading_list_v2()` in reader.py:
- Count is at byte 222 of V2 header
- Data starts after components (offset 258 + component_count * 6)
- Each entry is 2 bytes: (from_measure, to_measure)
**Frontend**: `expandNotationWithReadingList()` in work-view.js expands measures
**Files**: `sources/banjo-hangout/src/tef_parser/reader.py`, `docs/js/work-view.js`

### Cross-measure ties not rendering

**Cause**: Each measure is a separate SVG row, can't draw arc across
**Workaround**: Tied notes show bracket notation `[7]` instead of arc

### Notes clustered in first half of measure (2/4 time rendered as 4/4)

**Cause**: Time signature not passed to TabRenderer
**Symptom**: For 2/4 tabs, notes appear in first ~45% of each measure
**Fix**: Ensure time signature is passed as 4th argument to `renderer.render()`:
```javascript
const timeSignature = otf.metadata?.time_signature || '4/4';
renderer.render(track, notation, ticksPerBeat, timeSignature);
```
**Files**: `docs/js/song-view.js`, `docs/js/work-view.js` - both need to pass time signature

### Triplet timing off

**Cause**: 'K' marker notes need 2/3 duration, beamed together
**Fix**: Check triplet detection and grouping in otf.py

### Slide target renders off-grid with a rest before it (TablEdit's slide-timing hack)

**Symptom**: A slide target (e.g. `5 →/ 8`) renders as an eighth note pushed
OFF the beat grid with a little rest behind it, instead of a normal note on the
ruler. (Reported on salt-creek m1/m5.)

**Root cause — NOT a bug, it's TablEdit's design**: TablEdit fakes the *sound*
of a slide by storing rendering-hostile microtiming, so its MIDI playback bends
audibly. For `5 →/ 8` it emits, on one beat: a straight source eighth, a short
`<forward>` rest gap, then the slide TARGET compressed to a **triplet** value and
shifted off the grid. This is confirmed in BOTH the raw TEF duration code AND
TablEdit's own MusicXML export:

```
# TablEdit MusicXML (20627 m1, divisions=240):
note f5  dur120 (eighth)          slide-start
FORWARD  dur40                    ← the "16th rest"
note f8  dur80  time-mod 3:2      slide-stop   ← triplet, off-grid
# → in OTF ticks: source @0/dur240, target @320/dur160
```

It is a **playback-timing hack, not a musical triplet**.

**Fix (already in place)**: `normalize_slide_timing` in `otf.py` re-times the
target on-grid as a normal note carrying only the `/` articulation
(salt-creek m1: `320/160 → 240/240`). It gates on `tech in {"/","\\"}` so genuine
musical triplets (e.g. ground-speed/15313 — never slides) are untouched, and
only re-times the "triplet-compress" shape (off-16th-grid AND triplet duration).
Playback re-creates the slide feel in `tab-player.js` via WebAudioFont's native
`slides` param (the source rings, bends up, target hangs). The oracle stays
green because `spike/oracle_verify.py` applies the SAME transform
(`retimed_slide_target`) to the MusicXML side before comparing — so a change here
means "same notes as TablEdit, modulo the documented slide policy." See
`retimed_slide_target` / `normalize_slide_timing` in `otf.py`.

Note the distinct **32nd grace-slide** shape (source is a 32nd, target lands a
32nd late) is intentionally left as-is for now — 21 notes across 8 works; revisit
if those need cleaning too.

### Silent measures vanish from the display (labels jump the gap)

**Cause**: OTF omits measures with no events (TEF convention; timing preserves
their duration). Display consumers that iterate the notation array
back-to-back collapse them visually.
**Fix (in place)**: `densifyNotation()` fills gaps with empty entries in the
display prep (editor `_render`, work-view); `expandNotation()` emits empty
entries for silent slots. The saved OTF stays sparse.
**Files**: `docs/js/renderers/measure-timing.js`

### Annotations / fingerings / section labels not showing

The pipeline: parser emits OTF `annotations` (+ `finger`/`lh` on notes,
`name` on reading-list entries) → `attachOtfDecorations()` hangs them onto
the display notation (AFTER `densifyNotation` — texts can target silent
measures — BEFORE compact/expand) → renderer draws texts above the staff
(lane-stacked on overlap), section labels bold at row top, pluck letters and
circled fretting digits below the beams.
**Files**: `docs/js/renderers/measure-timing.js`, `docs/js/renderers/tablature.js`,
`docs/js/otf-editor/editor.js`, `docs/js/work-view.js`

## Key Files

| File | Purpose |
|------|---------|
| `sources/banjo-hangout/src/tef_parser/reader.py` | Binary parsing, marker filtering (Python oracle) |
| `sources/banjo-hangout/src/tef_parser/otf.py` | TEF→OTF conversion, articulations, triplets |
| `docs/js/tef-import/{reader,otf}.js` | In-browser JS port — MUST stay byte-exact vs Python (golden gate: `docs/js/__tests__/tef-import-golden.test.js`; regenerate fixture with `uv run python docs/js/tef-import/__fixtures__/gen_golden.py` whenever the Python parser legitimately changes) |
| `docs/js/renderers/tablature.js` | SVG rendering, slurs, brackets, bends, annotations |
| `docs/js/renderers/tab-player.js` | Audio playback, note scheduling, bend/slide waypoints |
| `sources/banjo-hangout/conversion_log.json` | Batch conversion results |

## Testing Changes

After modifying parser:

```bash
# Re-convert single file
uv run python sources/banjo-hangout/src/batch_convert.py

# Or convert specific file
uv run python -c "
from pathlib import Path
import sys
sys.path.insert(0, 'sources/banjo-hangout/src')
from tef_parser.reader import TEFReader
from tef_parser.otf import tef_to_otf

tef = TEFReader(Path('sources/banjo-hangout/downloads/{id}_tef.tef')).parse()
otf = tef_to_otf(tef)
Path('docs/data/tabs/{slug}-banjo.otf.json').write_text(otf.to_json())
"

# Test in browser
./scripts/server
# Navigate to http://localhost:8080/#work/{slug}
```
