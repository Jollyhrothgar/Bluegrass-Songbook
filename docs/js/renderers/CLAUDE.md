# Tablature Renderers

SVG-based tablature rendering and playback for OpenTabFormat (OTF) files.

## Files

| File | Purpose |
|------|---------|
| `index.js` | Renderer registry (`RENDERERS`, `getRenderer`, `detectFormat`); re-exports `TabRenderer`, `TabPlayer`, `isPercussionTrack`/`pitchedTracks`, the ChordPro entry points and all of `measure-timing.js` |
| `tablature.js` | `TabRenderer` class - converts OTF to SVG tablature |
| `tab-player.js` | `TabPlayer` class - audio playback with note highlighting |
| `tab-ascii.js` | ASCII tablature format (legacy, rarely used) |
| `chordpro.js` | THE ChordPro renderer (`parseChordPro`, `renderSectionsHtml/Ascii/PrintHtml`) — shared by every lead-sheet surface |
| `measure-timing.js` | Ts-aware measure math shared by renderer, player, work-view and the OTF editor (`expandNotation`, `readingListTimeline`, `measureTimingFromOtf`, …) |
| `otf-tracks.js` | `isPercussionTrack` / `pitchedTracks` — the shared "is this track pitched" filter |

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
    ↓ renderRow() → per-measure geometry
Note positions, fret numbers, articulations
    ↓ renderSlurs() (row-scoped, after all measures in the row are laid out)
Slur/tie arcs, including across barlines
```

### Articulations

The renderer shows these articulation marks:

| Articulation | Symbol | Rendered As |
|--------------|--------|-------------|
| Hammer-on | `h` | Slur arc above + "H" |
| Pull-off | `p` | Slur arc above + "P" |
| Slide | `/` | Slur arc + "sl" |
| Bend/choke | `b` | Tilted arrow + "½", target fret bracketed `[7]` |
| Tie | `tie: true` | Slur arc, continuation fret bracketed `[7]` |

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
