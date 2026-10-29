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
grep -A6 provenance works/{work-slug}/work.yaml
```

Look for:
- `source_id` - the Hangout tab ID (e.g. `20690`)
- `source_url` - the **detail page** on banjohangout.org, NOT a TEF download

### 2. Re-download the TEF file if needed

`provenance.source_url` is an HTML detail page — curling it gives you a web
page, not a tab. The real download URL (on `hangoutstorage.com`) lives in the
catalog, keyed `{id}_tef`:

```bash
python3 -c "
import json
print(json.load(open('sources/banjo-hangout/tab_catalog.json'))['tabs']['{id}_tef']['source_url'])
"
curl -L -o sources/banjo-hangout/downloads/{id}.tef "<that url>"
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

`evt.position` is on the **canonical V2 grid: 256 units per whole note**, i.e.
`header.v2_ts_size` units per measure. (It is NOT 16 slots per measure — that
old model was removed because it crushed 3/4 and 6/8 grids and any 32nds in
4/4.) So measure N spans `(N-1)*ts_size` to `N*ts_size - 1`:

```python
def show_measure(tef, measure_num):
    ts_size = tef.header.v2_ts_size
    start = (measure_num - 1) * ts_size
    end = start + ts_size
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

For V2 format, the 6-byte note record structure (as decoded in `reader.py`;
`evt.raw_data` is this record verbatim):
```
Bytes 0-1: location, u16 little-endian. reader.py derives all three of
           position_in_measure = location % ts_size
           cumulative_string   = (location // ts_size) % num_strings
           measure             = location // (ts_size * num_strings)
Byte 2:    fret byte. fret = (byte2 & 0x1f) - 1. Flags (byte2 & 0xe0) say
           what effect2 holds: 0x20 fingering, 0x40 grace note (effect2 =
           grace fret bits 0-4 + kind bits 5-7), 0x80 note attribute
           (staccato 0x07, ringing 0x01, ghost 0x04, ...). NOT a fret
           extension. Fret field 0x1b-0x1f / bare 0x1a = special
           component (text 0x1d, rest 0x1a, chord diagram 0x1c, ...).
Byte 3:    duration byte: bits 0-4 duration code, bits 5-7 dynamic.
           When 0x40 <= byte3 <= 0x5A it also reads as the marker CHARACTER
           ('I', 'F', 'L', 'K', ...). Dynamic 7 is the tie sentinel.
Byte 4:    effect1 (articulations)
Byte 5:    effect2 (overlays / annotations)
```

Some V2 files use a 4-byte stride instead of 6 (no effect bytes). Guard every
`raw_data[4]` / `raw_data[5]` read with a length check, as `otf.py` does.

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
```

Then rebuild — do **not** hand-write into `docs/data/tabs/`. That directory is
generated (and gitignored); `build_works_index.py` copies each tablature part
there under `{work}-{instrument}-{source_id}.otf.json` (see
`published_tab_name`) and prunes anything it didn't publish. A hand-placed
`{work-slug}-banjo.otf.json` is not a name it produces, so it gets pruned:

```bash
./scripts/bootstrap --quick
```

## TEF Format Reference

Byte-level detail is in `TEF-REFERENCE.md` beside this file: V2 vs V3
detection (byte 205, not the first byte), the V3 layout reverse-engineered on
Welcome to New York, the header pointers, chord diagrams, repeat signs,
dynamics (code 0 is the loudest; velocity `127 - 16 * code`), TablEdit's own
field names (fix-it A15), the V2 marker, Effect1 and Effect2 bytes, how ties,
slides and hammer-ons are detected, and **Writing a .tef** (G15f). Read it when
a fix depends on what a byte means or on what the writer puts back.

## Common Issues & Fixes

### Empty notation (0 events)

**Cause (fixed 2026-10-17, fix-it A12)**: V3 files carrying 'tbed' instead
of 'debt' at 0x38, and untitled V2 files misrouted to V3. Both parse now.
If a file still comes out empty, check `data[205]` (routing) and the u32 at
0x3C (note pointer) first.
**Check**: after a `batch_convert.py` run, `sources/banjo-hangout/conversion_log.json`
shows "Empty notation (0 events) - format: v3"

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
**Fix (current, and stronger than the old one)**: `fret += effect2` is gone
entirely. Bit 5 of the fret byte means "effect2 carries an annotation", NEVER a
fret extension — `fret_raw` already spans 0..24, the full banjo range. The
earlier partial fix (add effect2 only when `effect2 > 0x0c`) still corrupted
frets: in 21802 effect2 is 0xa2/0xa4, so the add pushed frets past 24 and those
notes were silently dropped. **Do not re-add any `fret += effect2` branch.**
**Files**: `sources/banjo-hangout/src/tef_parser/reader.py`, in the V2 note
branch — search for `fret_raw = fret_byte & 0x1f` (line numbers move)

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
**Files**: `sources/banjo-hangout/src/tef_parser/reader.py` — search for
`instrument_patterns` inside `parse_instruments` (line numbers move)

### Bends showing as pull-offs

**Cause**: effect1=0x04 was incorrectly interpreted as "explicit pull-off"
**Symptom**: Notes with 1/4 step bends show pull-off slurs
**Fix**: Removed 0x04 from legato detection - it's actually a bend indicator

### Bends: DECODED (G15d2) from effects 12 and 13, not the connect bit

**Status**: effect 12 (bend, up and hold) is fx `bend`; effect 13 is fx
`bend-release` (up and back). The TARGET is the next note on the same string of
the same track, tied or not, possibly in a later measure (`bend_target_keys` in
otf.py, `bendTargetKeys` in otf.js) → `tech: 'b'`, `tie: false`, never
re-attacked. There is no amount field: the amount is `target.f - source.f`
(1 = ½, 2 = full, 3 = 1½, 4 = 2; a lower target bends down). A bend with no
later note on its string, or whose target is already an h/p/slide
destination or on the same fret, is left alone. Most targets are NOT tied.
The old rule (connect bit + fret change = bend) was wrong: those notes
(`fret_changed_tie_keys`) are plain re-attacked notes now. The track flag
(+0x12 bit 10) that makes TablEdit bend with no destination is not decoded.

- **Render** (tablature.js): tilted-up arrow from the source note to the
  bracketed `[target]` fret, amount from `bendLabel(target.f - source.f)`; a
  rising-arrow band mark on the bent note (`.fx-bend`).
- **Playback** (tab-player.js): `absorbBend` folds the target into the source
  (one attack); `bendIntoWaypoints` ramps to the fret difference over the
  source note, as in TablEdit's MIDI (spike/oracle, `test_bends_oracle.py`).
  Choke (effect 4) is unchanged; an orphan `tech: 'b'` note is a quarter-tone.

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
**Frontend**: `analyzeReadingList()` / `readingListTimeline()` build the
timeline and `expandNotation()` emits the repeated measures — all in
`docs/js/renderers/measure-timing.js`, called from `work-view.js`. (There is no
`expandNotationWithReadingList()`; that name is dead.)
**Files**: `sources/banjo-hangout/src/tef_parser/reader.py`,
`docs/js/renderers/measure-timing.js`, `docs/js/work-view.js`

### Slur/tie arc missing (FIXED for barlines — check the ROW boundary)

**Not the cause**: "each measure is its own SVG". It isn't — a row holds
several measures (`measuresPerRow`) in one SVG, and `renderSlurs()` runs
per-row after the whole row is laid out, so ties AND techniques (`h`, `p`,
`/`) arc across barlines fine. Brackets on a tied fret `[7]` supplement that
arc, they don't replace it.

**Was a cause until 2026-08**: `renderSlurs()` gated technique arcs on a fixed
60px note-to-note distance, so any hammer/pull/slide spanning a quarter note
or more vanished entirely — no arc, no `sl`/`H`/`P` label (the tech-symbol
fallback skips h/p// on the grounds renderSlurs draws them), while playback
still sounded it. 7 of 27 slides in `foggy-mountain-breakdown/banjo.otf.json`
were invisible. Fixed by deleting the pixel gate: the source note is the
immediately preceding note on the same string, which is what the articulation
*means* and exactly what `tab-player.js` pairs. If you are ever tempted to
re-add a pixel threshold here, don't — it silently drops real notation and
re-breaks at every layout width.

**Still a real cause**: the ROW boundary. `renderSlurs` only sees one row's
notes, so a slur whose source is on the previous row can't be completed. Ties
draw an incoming half-arc from the margin (`.tie-arc-in`); techniques draw
nothing. Widen the window (or narrow `measuresPerRow`) to confirm that's what
you're looking at.
**Guard**: `docs/js/__tests__/tablature-slurs.test.js` renders the real FMB
banjo tab and asserts arc count == technique count.

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
| `sources/banjo-hangout/src/tef_parser/skipped.py`, `docs/js/tef-import/skipped.js` | Count what a `.tef` holds that OTF does not keep (`x_source.skipped`; golden-gated twins; reader-facing words in `docs/js/tef-skipped.js`) |
| `docs/js/tef-export/` | The `.tef` writer (`writeTef`, V3 only; `template.tef` is a blank TablEdit 3.06 file). Gate: every corpus `.tef` round-trips (`tef-roundtrip-exceptions.txt` pins the 3 that do not); layout in TEF-REFERENCE.md "Writing a .tef" |
| `docs/js/renderers/tablature.js` | SVG rendering, slurs, brackets, bends, annotations |
| `docs/js/renderers/tab-player.js` | Audio playback, note scheduling, bend/slide waypoints |
| `sources/banjo-hangout/conversion_log.json` | Batch conversion results. **Generated and gitignored** — it does not exist until you run `batch_convert.py`. Path comes from `site_config.SiteConfig.conversion_log_path`, so sibling Hangout sites write their own under their own `data_dir` |

## Testing Changes

After modifying parser:

```bash
# Re-convert single file
uv run python sources/banjo-hangout/src/batch_convert.py

# Or convert a single file with no catalog involved
./scripts/utility banjo-convert-file <tef_path> [output_path]

# Equivalent by hand. Downloaded TEFs are named {id}.tef or
# {id}_tef_{slug}.tef — check with `ls sources/banjo-hangout/downloads | grep {id}`
uv run python -c "
from pathlib import Path
import sys
sys.path.insert(0, 'sources/banjo-hangout/src')
from tef_parser.reader import TEFReader
from tef_parser.otf import tef_to_otf

tef = TEFReader(Path('sources/banjo-hangout/downloads/{id}.tef')).parse()
otf = tef_to_otf(tef)
Path('works/{slug}/banjo.otf.json').write_text(otf.to_json())
"

# Publish it into docs/data/tabs/ (that directory is build output)
./scripts/bootstrap --quick

# Test in browser
./scripts/server
# Navigate to http://localhost:8080/#work/{slug}
```

## Repeat signs (0xb7 V3 / 0x5e V2), decoded G15d4

Flag byte = V3 cell byte 2 (file byte 6) / V2 record byte 4, OR-ed per measure into OTF `measure_marks`.
0x40 repeat start, 0x80 repeat end, bits 0-2 = ending 1-6 (7 = unspecified, draws nothing), `&0x38`: 0x08 end bar, 0x10 Da Signo, 0x18 Signo, 0x20 Al Coda, 0x28 Coda. Use `decode_mark_raw` / `decodeMarkRaw`. Not expanded for playback.
