# Tablature Renderers

SVG-based tablature rendering and playback for OpenTabFormat (OTF) files.

## Files

| File | Purpose |
|------|---------|
| `index.js` | Renderer registry, exports `TabRenderer`, `TabPlayer`, `isPercussionTrack`/`pitchedTracks` |
| `tablature.js` | `TabRenderer` class - converts OTF to SVG tablature |
| `tab-player.js` | `TabPlayer` class - audio playback with note highlighting |
| `tab-ascii.js` | ASCII tablature format (legacy, rarely used) |

## TabRenderer

Renders OTF notation to SVG tablature staff.

### Key Methods

```javascript
const renderer = new TabRenderer(container, options);

// Render a track's notation
renderer.render(track, notation, ticksPerBeat, timeSignature);

// Update visible tracks (for multi-track)
renderer.setTrackVisibility(trackIndex, visible);

// Highlight a note during playback
renderer.highlightNote(measureIndex, noteIndex);
```

### Rendering Pipeline

```
OTF JSON
    ↓ expandNotationWithReadingList()
Expanded notation (repeats applied)
    ↓ render()
SVG rows (several measures per row — `measuresPerRow`, 'auto' by default)
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

For ensemble tabs (guitar + banjo + mandolin + bass):

1. Each track renders separately
2. Track mixer controls visibility
3. Solo mode shows only one track
4. Muted tracks are greyed out

## TabPlayer

Handles audio playback with synchronized note highlighting.

### Key Methods

```javascript
const player = new TabPlayer(otf, renderer, {
    onPlayStateChange: (isPlaying) => { ... },
    onProgress: (measureIndex, noteIndex) => { ... }
});

player.play();
player.pause();
player.stop();
player.setTempo(120);
player.seekToMeasure(5);
```

### Audio Generation

Uses Web Audio API with oscillators:

- Bass notes: sine wave
- Mid notes: triangle wave
- Treble notes: square wave (softer)
- ADSR envelope for natural attack/decay

### Timing

- `ticksPerBeat` from OTF metadata (usually 16 or 24)
- Note durations in ticks converted to ms using tempo
- Time signature affects measure boundaries

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

**Cause**: Notes too close together for arc
**Fix**: Check `renderSlur()` minimum distance logic in tablature.js

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
