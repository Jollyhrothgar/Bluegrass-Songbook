# TEF percussion (drum) tracks

Read this when a TEF converts with a `percussion` track, or before trying to
decode which drum a staff line means. General TEF debugging (V2 vs V3, marker
types, effect bytes) is in `.claude/skills/tab-debug/SKILL.md`.

## Detection

Many TablEdit arrangements (MandoTom2's especially) carry a drum track next to
the melodic ones. Detection is structural, never by track name, because
TablEdit lets the name lie (mandolin-hangout 2613's drum track is named
`Guitar Standard`):

- V2: the u16 at `track_record+6` equals 98 (`_PERCUSSION_FLAG` in
  `src/tef_parser/reader.py`).
- V3: bit 7 of the byte at `track_record+4` (matches TablEdit's V3 loader;
  fix-it item A13 in `docs/plans/2026-09-30-fix-it-list.md`).

TablEdit's own track dialog shows "Drum Tab" checked and MIDI channel 10 for
a flagged track, so the detection is right.

## Conversion

A flagged track's 8 "tuning" bytes are drum-kit staff-line assignments, so the
`96 - b` pitch formula must not run on them (it fabricated an 8-line guitar
tuning, drawn as a stave and played as guitar notes). Flagged tracks convert to
`{"id": "percussion", "instrument": "percussion", "tuning": [], "capo": 0,
"role": "percussion", "percussion": true, "lines": 8}`.

The frontend keeps them out of the mixer, playback and editor
(`docs/js/renderers/otf-tracks.js`); `build_works_index`'s `tracks` count
excludes them. The song page shows the track greyed out with a "drum notation
is in progress" note, because we detect drum tracks reliably but cannot say
which drum each staff line means. The notation is preserved, so a drum
renderer can use it later without reconverting.

## Unsolved: staff line to drum mapping

Ground truth was TablEdit MIDI exports of two tabs, each matching our OTF note
for note: mandolin-hangout 2927 (8 drum lines;
`sources/mandolin-hangout/downloads/2927_tef_gold_rush___bill_monroe.tef`) and
banjo-hangout 23579 (3 lines;
`sources/banjo-hangout/downloads/23579_tef_big_sciota.tef`). The `.mid` exports
are not in the repo, so these results cannot be re-run from the checkout.

Two hypotheses were falsified; do not retry them. The notes below are from the
original investigation and I could not re-verify the details against the code.

1. The drum-line bytes are not the drum assignment. These are the 8 bytes at
   track record +20 (the "tuning" bytes, one per drum line; see
   `_v2_record_to_instruments` in `src/tef_parser/reader.py`). They decode to
   plausible GM drum names, but both files carry the values 43 and 52 on lines
   that have notes, while their MIDI produces different drums ({36,41,43} vs
   {32,41}), and no 8-byte window in 2927 holds all four drums it plays
   ({36,41,43,51}).
2. A second per-line field, called `f` in the original notes, is not the drum
   selector (2927 lines 1 and 2 differ in it but play the same drum, GM 51;
   23579 lines 2 and 3 share it but play different drums). Which record and
   offset `f` is was not written down and is not in the parser; locate it
   before relying on this claim.

Two distinct lines mapping to the same drum suggests a derived mapping: a fixed
drum-tab template by line count (an app preference, not in the file), or the
track's MIDI kit ("TR-808 Set" on 2927). Whether it varies per file is
unknown. `src/tef_parser/drum_kit.json` holds TablEdit's 51-drum table (GM
note, name, tab symbol, staff position, notehead), scraped from the track
dialog's Configuration tab. Next lead: TuxGuitar's TablEdit importer, which
already validated our track-record layout.
