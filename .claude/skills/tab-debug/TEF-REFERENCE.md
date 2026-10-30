# TEF format reference

Byte-level notes for the tab-debug skill (`SKILL.md` beside this file): V2 and
V3 layouts, TablEdit's own field names, marker and effect bytes, and how ties,
slides and hammer-ons are told apart. Drum tracks are in
`sources/banjo-hangout/TEF-FORMAT.md`.

## V2 vs V3 Detection

```python
# Routing is TablEdit's own (reader.is_v3_layout): byte 205 of the file is
# the format version; 10 or more = V3. NOT the first byte — an untitled V2
# file starts with 0x00 like a V3 one.
# V3: the component region starts at the u32 at header offset 60 (0x3C).
#     The 'debt'/'tbed' magic at 0x38 is never read by TablEdit.

if tef.header.is_v2:
    # 6-byte note records (4-byte sub-variant exists),
    # positions on a 256-unit-per-whole-note grid
else:
    # 12-byte component records (see V3 reference below)
```

## V3 Format Reference (2026-07, reverse-engineered on Welcome to New York)

**Header pointer table** (u32 little-endian at fixed offsets):

| Offset | Points at |
|--------|-----------|
| 60 | Component (note) region (TablEdit seeks here; ends with u32 0xFFFFFFFF) |
| 64 / 68 / 72 / 76 | Title / author / comments / notes (each u16-len-prefixed; the comments' last line may be `Tab by: NAME <URL>`; the 76 block is the "free text" `x_source.skipped` counts) |
| 80 | Extra block (the writer keeps it; unread) |
| 84 | **Free-text table**: u16 count, then count × [u16 len][bytes, NUL-terminated] |
| 88 | Chord diagram table: u16 entry_size (36), u16 count, then records (name inside) |
| 92 / 96 / 100 | Measure table / track records / page-layout block (carried over by the writer) |
| 128 | Reading list: u16 entry_size (32), u16 count, then records |
| 132 / 140 | URL / copyright strings (carried over by the writer) |

**Reading-list records** (32 bytes): u16 from_measure, u16 to_measure, then a
NUL-terminated **entry label** ("Intro", "Part A1", ...) — TablEdit prints it
above the range's first measure. Parsed into `reading_list[].name` in OTF.

**12-byte component record** (TuxGuitar TEInputStream layout):

| Bytes | Meaning |
|-------|---------|
| 0-3 | location (u32) = `8 * (pos * total_strings + string_row)`, `pos` in 64ths of a whole note: `position = loc // (8*total_strings)`, `string_row = (loc // 8) % total_strings`. `pos` is continuous; `TEFFile.v3_locate(pos)` splits it by the measure table (a 6/4 measure is 96 units). |
| 4 | component type. Notes: bits 0-4 = fret+1 (0x01-0x19); 0x40 = grace flag. Non-notes below. |
| 5 | notes: the V2 duration byte, copied unchanged: duration code (bits 0-4) + dynamic (bits 5-7); **dynamic 7 = tie/connect**. Bit 7 alone is NOT a tie (dynamics 4-6 set it too). Text components: 0-based text-table index. |
| 6 | articulation: 1=hammer, 2=pull, 3=slide, **0x0c=bend/choke SOURCE**, 0x0f=dead/muted (chop ×) |
| 10 | **fingering pack, base-6**: `6*pluck + lh_code`. pluck 1..5 = T/I/M/R/P; lh_code 0 = none, else fretting digit = lh_code-1. (0x0a = T + finger 3, 0x0b = T + finger 4.) |

**Non-note component types** (skipped for notes): 0x33, 0x35, 0x36, 0x37,
0x38, 0x39, 0x3D, 0x75, 0x78, 0x7D, 0x7E, 0xB6, 0xB7, 0xBD, 0xBE, 0xFD, 0xFE.
Decoded so far:

| Type | Meaning | Parsed? |
|------|---------|---------|
| 0x39 | **Free-text anchor**: byte 5 = 0-based index into the text table at header ptr 84; location gives (measure, slot, string row) | Yes → OTF `annotations: [{measure, tick, text}]` (byte 7 = signed y-offset, ignored) |
| 0x35 | **Chord-diagram anchor**, compared on the FULL type byte (0x75 = scale diagram, 0xf5 = special character): record bytes 5-6 = u16 index into the chord table (header 88), byte 7 = signed dy, byte 8 = signed dx; the owning track is the one whose strings contain the string row | Yes → OTF `chords[]` + `chord_diagrams[]` (V2: fret byte 0x1c/0x5c/0x9c, byte 3 = chord index; dx/dy not decoded) |

**Chord record** (36 bytes V3, 32 V2): bytes 0-13 one per string, string 1 first (0xff not played, low 5 bits ABSOLUTE fret, high 3 bits 0 plain / 2-5 = finger 1-4); 14-30 NUL-terminated name; 31 first fret shown (signed; 1 on every corpus record that has no position label); V3 byte 32 = the diagram's string count (0 = the owning track's; 0 on every corpus record); 33 unknown (0). No barre is stored. **V2 table**: u16 count at file offset 236, 32-byte records right after the free-text table (reading list, then the u16-count-at-228 text entries); all 51 V2 files with a table read this way. A table that doesn't parse (a name byte below 0x20, no NUL, past EOF) drops its diagrams and is reported as `x_source.skipped.chord_diagrams`. Corpus (decode session, reproduced by `tests/parser/test_tef_chord_diagrams.py`): 380 V3 anchors in 17 files, 1,558 V2 in 40; 19 of 21 scorable diagrams spell their name with the owning track's tuning; 47 referenced records are name-only; 35 records are never referenced.

| 0xb7 | **Repeat signs** (V2: fret byte 0x5e): record byte 6 (V2 byte 4) is a flag OR-ed per measure into `measure_marks[].raw`: 0x40 repeat start, 0x80 repeat end, bits 0-2 ending 1-6 (7 = unspecified, draws nothing), `& 0x38` 0x08 end bar, 0x10 Da Signo, 0x18 Signo, 0x20 Al Coda, 0x28 Coda (`decode_mark_raw` / `decodeMarkRaw`). Drawn, kept and written back; not played | Yes → OTF `measure_marks` |

All of the above oracle-verified against TablEdit's own MusicXML export
(`<words>`, `<pluck>`, `<fingering>`, `<harmony>`): 35/35 text placements and
37/37 fingerings match on Welcome to New York.

## Writing a .tef (G15f, `docs/js/tef-export/`)

`writeTef(otf, {source, template})` writes V3 only. Everything OTF models is
rewritten; the rest (unknown header bytes, per-track settings, the 0x64
page-layout block, the notes/URL/copyright strings, measure flags) is carried
over from `source` (the original V3 file, when its tracks match) or from
`template.tef` (blank, saved by TablEdit 3.06). Layout, as TablEdit saves it:
header 0x100, title, author, comments, notes, [URL, copyright], +0x50, text
table, chord table, measures, tracks, 0x64 block, reading list, components
(last; ends in `ff ff ff ff`). A zero pointer is an absent block.

- **Title** = pointer 64 (`titleFromHeader`, both readers); a title with control
  characters (multi-line) still falls back to the first-string heuristic, so
  the writer turns line breaks into spaces. **Author** (0x44, TablEdit's name;
  imported raw as `composer`, like V2; read by both importers).
- **Credit**: `metadata.tab_by` is the last comments line `Tab by: NAME <URL>`
  (the colon matters: about 30 corpus files say `Tab by Name` and are left alone).
  Failing that, TablEdit's own default `TablEdited by NAME` line (V2 and V3; also `Arranged|Transcribed|Modified
  and|& TablEdited by`, `TablEdited and|& Arr.|Arranged by`) when NAME is clean: at most 60 characters and 6 words, words of
  letters, digits and `. ' -`, each with a letter; 228 corpus files. Anything else stays plain comment text. The writer
  keeps a V2 source's comments too and adds no second credit line when the existing one already reads as this `tab_by`.
- **Capo**: +12 is the capo (read by us and by TablEdit's loader). +10's low
  nibble is the 5-string capo offset `capo + t1 - t5 - 5` (V2 loader
  FUN_10004632c recomputes it; 14 of 16 corpus 5-string capo records agree).
- **Duration**: lowest code for a tick count (corpus: code 6 x23,062 and 18
  x726; 30, 21, 24, 27 never). A triplet's position is stored straight; the
  writer searches for the unit that `retimeTriplet` maps back to the tick.
- **Effects**: primary = byte 6 low nibble, shared with the h/p/slide code
  (on the SOURCE note) and 0x0f dead; attribute = byte 8 low; second = byte 8
  high (a second effect of 3 hides the attribute). Overflow is counted.
- **Cells**: one component per (position, row). Text, repeat signs and chord
  anchors take the first free cell (chords on a row of their own track) unless
  the original V3 file is the template: its cells for the same text at the same
  position, the same marks (their `raw` bits OR to the measure's mark) and the
  same chord at the same position go back on their own row with their own bytes.
  Text bytes: 0x39, index, byte 9 = 3. Marks: 0xb7, byte 5 = 1, byte 6 = raw,
  byte 7 = 1 (117 corpus cells; 19 more have byte 5 = 0, byte 8 = 1).
- **Tracks**: the name is chosen so `instrumentToOtfId/Type` and the lead rule
  (name has banjo/mandolin) read it back as this track; an original's name
  bytes stay when they do, the empty name too (the importer then names the
  track after its MIDI program). Drum tracks: +4 bit 7, tuning bytes are
  placeholder line codes. **Byte 16 bits 4-6** is what a V3 track shows (1 tab,
  2 notation, 3 both, 0 hidden; MusicXML export, FUN_1000982f0; bit 7 unknown:
  0x90 on the first track and 0x80 on the rest in about 20 multi-track
  files, 0x10 first tracks 58 of 91, 0x30 12): a created track shows tab only,
  an original's byte stays. A V2 track is not read from byte 16: TablEdit
  exported tab only for 0x00, 0x10, 0x20, 0x30, 0x90 and 0xa0, tab plus
  notation for 0xb0 (308, two tracks), nothing for 0x80. The V2 upgrade that
  decides is not in our decompiles, so V2 tracks are created, tab only.
  The document-wide **Settings ▸ General ▸ Notation** switch is the 0x64 layout
  block +17 bit 1 and +78 bit 0 (blank file saved on vs off: only these and
  byte 16 differ); the template has it on, so a file written from the template
  clears both, or TablEdit still exports a notation staff.
  **MIDI program** (+8): 105 banjos, 110 fiddle, 25 the rest, 32 upright bass.
  An unedited original's track records come back byte for byte (all 91 V3
  corpus files): drum-line codes, the capo offset at +10 and the bytes after
  the last string stay while the capo and tuning do.
- **What TablEdit's own MusicXML export of a rewritten file still differs in**
  (G15f oracle, 50 corpus files, tab staff only; the OTF does not hold these):
  explicit rests (0x33; also what sets some notes' voice), voices, the key
  signature (V2 header byte 206; V3 measure record byte 2, a signed count of
  sharps, per measure), the track and row a text sits on in a V2 file, V2
  track names and MIDI programs, drum-line codes (+20 of a drum track), trailing
  empty measures, a bend target that was tied (dyn 7), fingering bytes above 35
  (flags 0x80/0x40/0x20 over `6 * pluck + lh`: 60 V3 notes in 4 files, 894 V2
  notes in 20; the importer reads none of them), second effect 11 (byte 8 =
  0xb0), the enharmonic bits (byte 6 & 0xc0), a slide with no destination and
  its byte 7, and the cell types nothing reads (0x3e stroke/fingering, 0xb6, 0xfd).
- **Limits**: 15 tracks, 12 strings, 2048 measures, 100 reading-list entries,
  names of 27 characters, text index one byte (256 texts), frets 0-24,
  denominators 1/2/4/8/16. `notices` counts everything else.

## TablEdit's own names (2026-10, fix-it A15)

Read from TablEdit 3.06 with REA/Ghidra. Prefer these over guessing from
byte patterns. The census that counts them is
`spike/tabledit_export/feature_census.py`, and the full survey is
`docs/plans/2026-10-18-tef-feature-survey.md`.

- **Note effect** = V3 byte 6 `& 0x0f` = V2 effect1 `& 0x0f` (string table at
  0x1000f57e0): 0 none, 1 hammer-on, 2 pull-off, 3 slide, 4 choke, 5 brush,
  6 natural harmonic, 7 artificial harmonic, 8 muted, 9 tapping, 10 vibrato,
  11 tremolo, 12 bend, 13 bend and release, 14 roll, 15 dead note. Bits 4-5
  are the voice (0x20 upper, 0x30 lower). Bits 6-7 are the enharmonic
  spelling.
- **Dynamics** (byte 5 / V2 byte 3, bits 5-7; the 4-byte V2 variant uses
  byte 3 too). **Code 0 is the loudest**: 0 fff, 1 ff, 2 f, 3 mf, 4 mp,
  5 p, 6 pp, 7 = tie. MIDI velocity is `127 - 16 * code` (f = 95), measured
  from TablEdit's Rich-MIDI export; the palette handler stores `0x27 - tag`.
  There is no ppp. Code 2 (f) is the most common level, not p. OTF:
  `tracks[].dyn` is the track's most common non-tie level, `note.dyn` only
  where it differs (`dynamic_code` / `assign_dynamics` in `otf.py`, the same
  names in camelCase in `otf.js`).
- **Note attribute** (V3 byte 8; V2 effect2 under fret flag 0x80): the low
  nibble is 1 ringing, 2 slap, 3 rasgueado, 4 ghost, 5/6 tremolo bar,
  7 staccato, 8/9 fade. The high nibble is a second effect (1 h, 2 p,
  3 roll, 5 brush, 6/7 harmonic, 8 ringing, 9 ghost, 10 dead).
- **Grace**: V3 type bit 0x40 / V2 fret flag 0x40 on the MAIN note. The
  grace's fret is in bits 0-4 of V3 byte 7 / V2 effect2, and its kind in
  bits 5-7 (1 hammer/pull, 2 slide, 3 bend, 4 mordent, ...).
- **Special types** (full byte, table at 0x1000f3cbc): 0x33 rest, 0x35 chord
  diagram, 0x36 line break, 0x37 accent, 0x38 crescendo, 0x39 text,
  0x3d slur/bracket, 0x3e stroke/fingering, 0x75 scale diagram,
  0x78 percussion, 0x7e MIDI patch, 0xb7 reading guide (repeat barlines:
  flag 0x40 start, 0x80 end), 0xfe tempo change, 0xf5 special character.
- **V2 → V3** (the V2 upgrade FUN_1000459c4) maps by the whole fret byte:
  0x1d text, 0x3d slur, 0x5d special char, 0x7d spacing, 0x9d line break,
  0xdd musical sign, 0x1e accent, 0x3e stroke/fingering, 0x5e reading
  guide, 0xde percussion, 0x9e crescendo, 0x1a rest, 0x1c/0x5c/0x9c chord
  diagram.

## Marker Types (V2 byte 3)

⚠️ Byte 3 is really the **duration byte** (bits 0-4 duration code, bits 5-7
dynamic). Reading it as a character is a historical misread that `reader.py`
still carries as `marker_char` because the filtering below keys on it. It is
useful for triage, but never derive duration, dynamics or ties from the
"marker" — use `decode_duration_code(byte3 & duration_mask)` and
`is_tied_note()` instead.

| Byte | Char | Meaning | Action |
|------|------|---------|--------|
| 0x49 | 'I' | Initial/melody note | Keep |
| 0x46 | 'F' | Fret/melody note | Keep |
| 0x4C | 'L' | Legato (hammer/pull) | Keep, check direction for h/p |
| 0x4B | 'K' | Triplet note | Keep, apply triplet timing |
| 0x43 | 'C' | Chord diagram | **SKIP** |
| 0x44 | 'D' | Diagram overlay | **SKIP** |
| 0x40 | '@' | Alternate/chord tone | Heuristic: keep highest fret only |

## Effect1 Byte (V2 byte 4) - Articulations

| Value | Meaning |
|-------|---------|
| 0x00 | No effect |
| 0x01 | Hammer-on or pull-off (check fret direction) |
| 0x02 | Unknown (possibly slide related) |
| 0x03 | Slide (bits 0x01 + 0x02 both set) |
| 0x04 | Bend (1/4 step) - NOT legato, ignore. **This bit is noise** — see "Bends" in `SKILL.md` |

`has_legato_effect` masks `effect1 & 0x03`; `is_slide_effect` requires
`effect1 == 0x03`. Ties are NOT in effect1 — see "Tie Detection" below.

## Effect2 Byte (V2 byte 5) - Overlays

| Value | Meaning |
|-------|---------|
| 0x07 | With fret flag 0x00: chord overlay - **SKIP this note**. With flag 0x80 it is staccato (keep). |

## Tie Detection

**`byte3 & 0x80` is the OLD, WRONG rule — do not reintroduce it.** It also
matched dynamics 4 and 5 (0x80-0xBF) and silently dropped those notes as
phantom ties (21690 m4, 21999 m10, 22446, 23439 — their oracle exports show
plain notes). The tie sentinel is dynamic **7**, i.e. the top three bits:

```python
# sources/banjo-hangout/src/tef_parser/otf.py :: is_tied_note
def is_tied_note(evt):
    if evt.raw_data and len(evt.raw_data) >= 6:
        if len(evt.raw_data) == 6:            # V2
            return (evt.raw_data[3] >> 5) & 0x07 == 7
        return bool(evt.raw_data[5] & 0x80)   # V3 (12-byte record)
    return False
```

The same sentinel is the "connect" bit that bend/choke detection keys on —
see "Bends" (`bend_target_keys`, and `fret_changed_tie_keys` for the old misread) in `SKILL.md`.

## Slide vs Hammer-on Detection

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

