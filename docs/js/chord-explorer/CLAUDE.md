# Chord Explorer

Interactive chord progression builder with Web Audio playback. Lets users compose, preview, and loop chord progressions in any key.

## Structure

```
chord-explorer/
├── main.js      # Application wiring, event listeners, UI state
├── theory.js    # Music theory: diatonic/non-diatonic chords, voicings, MIDI
├── grid.js      # Beat grid data model (ChordGrid) and UI renderer (GridView)
└── synth.js     # Web Audio polyphonic synthesizer (ChordSynth)
```

## How It Works

1. User picks a key → chord palette populates with diatonic + non-diatonic chords
2. Click or drag chords onto the beat grid
3. Grid cells show chord name + Roman numeral; clicking a cell selects it for editing
4. Controls bar appears for adjusting quality (maj/min/7), inversion, and octave
5. Play button schedules all chords via Web Audio with beat-accurate timing
6. State persists to localStorage across page reloads

## Key Modules

### theory.js

- `getDiatonicChords(key, use7ths)` - I-vii chords for a major key
- `getNonDiatonicChords(key, use7ths)` - Secondary dominants, borrowed chords
- `getChordVoicing(chord, inversion, octave)` - Convert chord to MIDI notes
- `getResolutions(chord, key)` - Common resolution patterns (e.g., "V → I")
- `noteToMidi()` / `midiToNote()` - Note ↔ MIDI conversions

### grid.js

- `ChordGrid` - Data model: 1D cell array (beats based on time signature), resize, get/set
- `GridView` - UI: renders grid, handles drag-and-drop, keyboard shortcuts (Delete/Escape), playback cursor animation
- `GridView.play()` / `stop()` - Schedule chords with sustain-until-next behavior
- `GridView.loadFromStorage()` / `saveToStorage()` - localStorage persistence

### synth.js

- `ChordSynth` - Polyphonic synth: sawtooth oscillators → low-pass filter → ADSR envelope
- `playChord(midiNotes, duration)` - Immediate playback (for previews)
- `scheduleChord(midiNotes, startTime, duration)` - Future playback (for grid sequencing)
- `getSynth()` - Singleton accessor (lazy AudioContext init for autoplay policy)

### main.js

Entry point. Wires key selector, tempo/bars/time-sig controls, play/stop/loop/clear buttons, and chord palette rendering. Manages `currentKey`, `selectedChord`, and grid panel state.
