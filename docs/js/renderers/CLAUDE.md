# Tablature Renderers

SVG-based tablature rendering and playback for OpenTabFormat (OTF) files.

## Files

| File | Purpose |
|------|---------|
| `index.js` | Renderer registry, exports `TabRenderer`, `TabPlayer`, `INSTRUMENT_ICONS` |
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
SVG rows (one per measure)
    ↓ renderMeasure()
Note positions, fret numbers, articulations
```

### Articulations

The renderer shows these articulation marks:

| Articulation | Symbol | Rendered As |
|--------------|--------|-------------|
| Hammer-on | `h` | Slur arc above + "h" |
| Pull-off | `p` | Slur arc above + "p" |
| Slide | `/` or `\` | Slur arc + "/" or "\" |
| Tie | `~` | Bracket notation `[7]` |

**Note**: Cross-measure ties use bracket notation because each measure is a separate SVG row.

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

## INSTRUMENT_ICONS

SVG icons for track mixer:

```javascript
import { INSTRUMENT_ICONS } from './index.js';

// Icons available:
INSTRUMENT_ICONS['5-string-banjo']  // Banjo icon
INSTRUMENT_ICONS['6-string-guitar'] // Guitar icon
INSTRUMENT_ICONS['mandolin']        // Mandolin icon
INSTRUMENT_ICONS['upright-bass']    // Bass icon
INSTRUMENT_ICONS['fiddle']          // Fiddle icon
```

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
