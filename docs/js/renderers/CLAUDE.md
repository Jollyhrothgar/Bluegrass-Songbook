# Tablature Renderers

SVG-based tablature rendering and playback for OpenTabFormat (OTF) files.

## Files

| File | Purpose |
|------|---------|
| `index.js` | Renderer registry (no longer imported by `work-view.js`, which loads `tablature.js`/`tab-player.js` lazily; still the registry for tests and other callers) (`RENDERERS`, `getRenderer`, `detectFormat`); re-exports `TabRenderer`, `TabPlayer`, `isPercussionTrack`/`pitchedTracks`, the ChordPro entry points and all of `measure-timing.js` |
| `tablature.js` | `TabRenderer` class - converts OTF to SVG tablature |
| `tab-player.js` | `TabPlayer` class - audio playback with note highlighting |
| `tab-ascii.js` | ASCII tablature format (legacy, rarely used) |
| `chordpro.js` | THE ChordPro renderer (`parseChordPro`, `renderSectionsHtml/Ascii/PrintHtml`) — shared by every lead-sheet surface |
| `measure-timing.js` | Ts-aware measure math shared by renderer, player, work-view and the OTF editor (`expandNotation`, `readingListTimeline`, `measureTimingFromOtf`, …) |
| `otf-tracks.js` | `isPercussionTrack` / `pitchedTracks` — the shared "is this track pitched" filter |
| `tab-hit-test.js` | `positionFromSvgPoint` — SVG point → `{measure, tick, string}`. Lives here (not in `otf-editor/`) so reading-view click-to-play does not load the editor; `otf-editor/cursor.js` re-exports it |

## TabRenderer

Renders OTF notation to SVG tablature staff.

### Key Methods

```javascript
const renderer = new TabRenderer(container, options);

// Render ONE track's notation (a 5th arg passes a MeasureTiming/timeline)
renderer.render(track, notation, ticksPerBeat, timeSignature, timing);

// Highlight during playback — keyed by ABSOLUTE TICK, not measure/note index
renderer.highlightNote(absTick);
renderer.clearNoteHighlight(absTick);
renderer.updateBeatCursor(absTick, options);
renderer.resetPlaybackVisualization();
renderer.destroy();
```

There is **no `setTrackVisibility`**. One `TabRenderer` draws exactly one
track into one container; multi-track works build one renderer per track and
`work-view.js` shows/hides the containers itself (the "View track" selector).
Audio muting is the player's job — `player.setTrackEnabled(trackId, enabled)`.

### Rendering Pipeline

```
OTF JSON
    ↓ prepareCompactNotation() → expandNotation()   (measure-timing.js,
      driven by readingListTimeline(); called from work-view.js)
Expanded notation (repeats applied)
    ↓ render()
SVG rows (several measures per row — `measuresPerRow`, 'auto' by default)
    ↓ every measure gets the SAME slot (`uniformMeasureWidth`, on by
      default) so barlines line up row over row; a short measure
      (pickup, mid-tune 2/4) uses its own fraction of the slot, pushed
      right so its last tick lands on the barline. `false` restores the
      old proportional widths.
    ↓ tick 0 is the START of the note area in every full measure — there
      is no per-measure centering (removed 2026-10-21, fix-it A17). It
      split the space after the last onset across both sides, which put an
      empty bar's tick 0 mid-measure; since rests are drawn in that space
      it pushed them past the barline (1,622 measures, 82 tabs), and the
      editor's ruler/cursor, which share the mapping, overran the bar. Every
      consumer reads `noteX0 + noteOffset + tick / ticks * noteW`;
      `noteOffset` is now only a short measure's right-alignment.
    ↓ renderRow() → per-measure geometry
Note positions, fret numbers, articulations
    ↓ renderSlurs() (row-scoped, after all measures in the row are laid out)
Slur/tie arcs, including across barlines
```

### Rhythm: stems, beams, flags, rests

Three beam levels, read in ticks (`renderStemsAndBeams`): 1 = eighth (the
primary beam), 2 = sixteenth, 3 = thirty-second (fix-it A21 follow-up;
the engine used to stop at 16ths, so two 32nds in one 16th slot shared no
beam and a lone 32nd got two flags).

- **A note's level** is the max of what its WRITTEN duration says
  (≤ 60 → 3, < 240 → 2), its position (an odd 16th slot → 2; a 32nd grid
  point off the 16th grid → 3) and the gap to the next note (≤ 60 → 3,
  ≤ 120 → 2). Positions count only on real 32nd grid points, so an
  undetected triplet at 160/320 never grows a third beam.
- **Two neighbours are joined at a level** when both carry it and nothing
  silent lies between them: one unit apart, or the first one's written
  duration (at that level) reaching the second — a dotted 16th + 32nd
  share the 16th beam, and the 32nd gets a third-beam stub.
- **Stubs**: a note carrying the level but joined at it on neither side.
  Level 2 stubs only a WRITTEN 16th (as it always has); level 3 any 32nd.
- **Beamable** (`_beamRuns`): the gap to the next onset, or the written
  duration when that is SHORTER — a beat's last note before a rest still
  beams with its beat. Never longer: banjo notes are routinely written to
  ring past the next onset.
- Unbeamed: no stem (whole), stem (half, quarter), 1 / 2 / 3 flags for an
  8th / 16th / 32nd.
- Beam rects carry `data-beam="<level>"`.
- **Rests** (`restGlyphSequence(len, start)`): each rest is the largest
  value that fits and starts on a multiple of itself, so small values fill
  out the beat first. Drawn 6 units right of their tick, or half their own
  span when that is narrower (a 32nd rest at ordinary zoom).

A corpus diff (all 1,186 tracks, jsdom, old vs new) on the change: 804
identical; the rest were rest ORDER (quarter-then-half instead of
half-then-quarter), eighth pairs before a rest or a triplet that were
flagged separately and now beam, 32nd content, and a handful of stub-vs-
beam calls on overlapping durations.

### Articulations

The renderer shows these articulation marks:

| Articulation | Symbol | Rendered As |
|--------------|--------|-------------|
| Hammer-on | `h` | Slur arc above + "H" |
| Pull-off | `p` | Slur arc above + "P" |
| Slide | `/` | Slur arc + "sl" |
| Bend/choke | `b` | Tilted arrow + "½", target fret bracketed `[7]` |
| Tie | `tie: true` | Slur arc, continuation fret bracketed `[7]` |
| Dead note | `x` | `×` in place of the fret |

TablEdit's per-note effects (`note.fx`, `note.grace`; format in
`otf-editor/DESIGN.md`) draw in four places, so stacked marks never land on
each other, on H/P/sl labels, or on a chord neighbour's digit (strings are
14px apart, chips 14px tall: there is no room for labels *inside* the staff):

| `fx` / field | Rendered As | Where | Class |
|---|---|---|---|
| `ghost` | `(5)` | on the fret | `.note-text.fx-ghost` |
| `harmonic` | `<12>` | on the fret | `.note-text.fx-harmonic` |
| `artificial-harmonic` | `<12>` + "A.H." | fret + band | `.fx-artificial-harmonic` |
| `staccato` | dot above the column's topmost note | on the staff | `.fx-staccato` |
| `brush` | vertical arrow toward string 1 (direction not decoded yet) | left of the column, ONE per column | `.fx-brush` |
| `roll` | vertical wavy line | left of the column, one per column | `.fx-roll` |
| `tremolo` | three slashes across the stem | below the staff | `.fx-tremolo` |
| `choke` / `tap` / `slap` | "ch" / "T" / "S" | band, point lane | `.fx-choke` … |
| `vibrato` / `bend-release` | short wave / up-down arrow | band, point lane | `.fx-vibrato` … |
| `let-ring` / `muted` | "let ring" / "P.M." once, then `- - -┐` over the run | band, one run lane each | `.fx-let-ring`, `.fx-let-ring-line` |
| `grace: {f, kind}` | small fret left of the main fret + slur; "h"/"p" for `hp` (by direction), "sl" for `slide`, bare arc otherwise | on the string | `.grace-note`, `.grace-arc`, `.grace-label` |

- **The band** sits above the staff (and above ending brackets), and is
  reserved like the free-text band: uniformly, and only when the tab has a
  point or run mark (`fxLanesFor()` — one scan per render). A tab without
  them renders byte-identically to before.
- **A grace moves nothing.** It has no tick; it sits in the gap the layout
  already left, shrinking (to 5px) rather than running into the previous
  column, and drops its background chip when even that does not fit, so it
  never blanks a neighbour's digit.
- A run breaks at a column without the effect and re-labels on a new row.

**Cross-barline arcs work.** A row holds several measures in ONE SVG
(`measuresPerRow`), and `renderSlurs()` runs once per row after every measure
in it is laid out — so ties AND techniques arc across barlines freely. The
pairing is musical, not spatial: the source is the immediately preceding note
on the same string, with no pixel-distance gate (a fixed cap used to eat any
technique spanning a quarter note or more, and re-broke at every new layout
width). Brackets are a *supplement* to the tie arc, not a substitute for it.

**The remaining limitation is ROW boundaries**, not measure boundaries:
`renderSlurs` only sees one row's notes, so a technique or tie whose source
sits on the previous row gets no full arc. Ties draw an incoming half-arc from
the margin (`.tie-arc-in`); techniques currently draw nothing.

### Multi-Track Support

For ensemble tabs (guitar + banjo + mandolin + bass). **Sound and sight are
two separate controls** — the renderer owns neither:

1. Each track gets its own `TabRenderer` and its own container
2. The **"View track" tabs** (`work-view.js`) decide which staff you SEE —
   they show/hide containers, they do not touch audio
3. The **track mixer checkboxes** decide what you HEAR — `.track-checkbox` →
   `player.setTrackEnabled(trackId, enabled)`, applied live mid-playback via
   per-track gain buses. Muting a track does not grey out or hide its staff
4. **Solo** (`.track-solo`, injected onto the renderer's track-info row) is
   also audio-only: "hear only this track, click again for all"
5. Percussion tracks are excluded from the mixer and playback
   (`pitchedTracks`); the song page still draws a greyed
   `.percussion-track` placeholder — see `docs/js/CLAUDE.md`

## TabPlayer

Handles audio playback with synchronized note highlighting.

### Key Methods

The constructor takes **no arguments** — the OTF and every playback option go
to `play()`, and progress is reported through assignable callback properties,
not a handler object.

```javascript
const player = new TabPlayer();

// Callbacks are plain properties; every one is keyed by ABSOLUTE TICK
player.onTick        = (absTick) => { ... };
player.onNoteStart   = (absTick) => { ... };
player.onNoteEnd     = (absTick) => { ... };
player.onBeat        = (absTick) => { ... };
player.onPositionUpdate = (elapsed, totalDuration) => { ... };
player.onPlaybackEnd = () => { ... };

await player.loadInstruments(otf.tracks);
await player.play(otf, {
    trackIds,      // which tracks are AUDIBLE at start (all are scheduled)
    tempo,         // BPM override
    transpose,     // semitones (capo simulation)
    loop,
    startTick,     // play from this absolute tick
    endTick,       // stop here, exclusive; with loop, the range repeats
    feel,          // 'two' presents 4/4 as cut time (metronome only)
    countInBeats
});
player.stop();
player.setTrackEnabled(trackId, enabled);   // live, mid-loop
player.setMixerSettings(trackId, settings);
```

There is **no `pause()`, `setTempo()` or `seekToMeasure()`** — tempo and range
are `play()` options, and stopping/restarting is how the UI re-seeks.

### Audio Generation

Notes are played from **WebAudioFont soundfonts**, not oscillators:
`INSTRUMENTS` maps banjo / guitar / bass / violin / mandolin / dobro to GM
patches, loaded from the `WEBAUDIOFONT_URLS` CDN by `loadInstruments()`.
`getInstrumentKey(instrumentType)` picks the patch from the OTF track's
instrument name. The only raw oscillator in the file is the metronome click
(a short sine with a quick decay, `playMetronomeClick`).

### Techniques, effects and grace notes

`tech` transitions: a tie continuation never re-attacks (`applyTieExtensions`);
`h`/`p`/slide targets are ONE pick — the source rings on and its pitch steps or
glides (`absorbLegato` + `legatoWaypoints`); `x` is a short damped chop; `b`
bends a quarter tone. Pitch moves all go through WebAudioFont's `slides`
waypoints (8th arg of `queueWaveTable`).

TablEdit's `note.fx` / `note.grace` (fix-it A15, format in
`otf-editor/DESIGN.md` "interface Note") are played the way TablEdit plays
them. All of it is pure exported helpers — `fxDurationVolume` (length and
gain), `applyStrumOffsets`/`strumOffsets` (brush/roll), `soundingMidi`
(harmonics) and `noteAttacks` (everything one note sounds, as attacks at
offsets from its onset) — so `play()` only queues what they return. The
constants are named and exported at the top of the fx block in
`tab-player.js`; tune there.

| fx | Playback |
|----|----------|
| `brush` | chord column (same track + tick) strummed low string (highest `s`) to high, 15ms a string, ≤70ms total; first attack on the written tick |
| `roll` | same, 50ms a string, ≤250ms total |
| `staccato` | sounded duration halved (TablEdit's rule) |
| `ghost` | 0.4× volume |
| `let-ring` | rings to the next note on the SAME string (ignores the rhythmic cut-off and the bass/guitar chop rules), max 4s |
| `muted` | palm mute: pitched, ≤0.13s, 0.7× volume (not `tech: 'x'`, the pitchless chop) |
| `choke` | attack, bend up 1 semitone over ≤80ms, cut at 0.3s |
| `harmonic` | natural harmonic above the OPEN string: 12→+12, 7/19→+19, 5/24→+24, 4/9/16→+28, 3→+31; other frets fretted +12. 0.85× volume, rings 1.5× (to the next note on the string) |
| `artificial-harmonic` | fretted pitch +12, same softer/longer ring |
| `vibrato` | ±0.25 semitone triangle at 5.5 Hz through the note |
| `tremolo` | re-picked every 1/32 note for the note's length; repeats 0.8× |
| `bend-release` | up a whole step over the first third, hold, back over the last third |
| `slap` | 1.15× volume |
| `tap` | played as written |

**Grace** (`note.grace = {f, kind}`, on the MAIN note) sounds a 1/32 note or
45ms (whichever is shorter) BEFORE the main note, on the same string; the main
note never moves. `kind: 'hp' | 'slide'` (every grace in the Banjo Hangout
corpus) is ONE pick: the grace attacks and steps/glides into the main pitch at
the main onset, and the main note is not re-attacked. Any other kind (or none)
is two attacks: a short grace at 0.8× then the main note. Grace pitch takes the
`transpose` option; it rides on the main note's record, so play-from-cursor
clipping keeps or drops both together, and highlight callbacks fire on the
main note's `absTick`.

**Combining**: gains multiply; let-ring sets the length first, then
muted/choke/staccato can still shorten it. One pitch shape per attack, in
precedence order: legato legs > bend-release > choke > `tech: 'b'` > vibrato.
Tremolo re-picks carry no pitch shape. Open-ended playback extends its end
(normally last note + 1s) to cover a ringing fx note, so a let-ring final
chord is not cut off by `stop()`.

### Timing

- `ticksPerBeat` from the OTF's `timing.ticks_per_beat` (**480** everywhere in
  this corpus; also the renderer's and player's default)
- Note durations in ticks converted to ms using tempo
- Time signature affects measure boundaries (`measureTimingFromOtf`)

## No instrument emoji in the tab UI

Removed 2026-08-02 (with the `INSTRUMENT_ICONS` map). Unicode has a banjo,
a guitar and a violin and **nothing** for mandolin, upright bass or dobro,
so those all rendered as a generic guitar. Worse, the mixer picked its icon
from `track.instrument` while the chip label came from `track.id`, so a
mislabeled track (id `guitar`, instrument `5-string-banjo`) showed a banjo
beside the word "guitar".

The tab page now uses text: a speaker glyph labels the Sound row, the track
options are plain names, and the staff selector is labelled "View track".
Don't reintroduce per-instrument emoji here — the coverage isn't there.


## Common Issues

### Notes clustered in first half of measure

**Cause**: Time signature not passed to renderer
**Fix**: Pass time signature as 4th argument to `render()`

### Slurs not rendering

**Cause**: the arc's source note is on the PREVIOUS ROW (see the row-boundary
limitation above) — *not* a distance problem: the pixel-distance gate was
removed, and there is no `renderSlur()` singular.
**Fix**: check `renderSlurs()` in tablature.js (it is row-scoped, and only
pairs a note with the immediately preceding note on the same string).

### Wrong playback speed

**Cause**: ticksPerBeat not matching OTF metadata
**Fix**: Ensure OTF metadata includes correct `ticks_per_beat`

## Testing

```bash
# Unit tests
npm test -- tablature

# E2E tests for tab rendering
npm run test:e2e -- work-view.spec.js
```
