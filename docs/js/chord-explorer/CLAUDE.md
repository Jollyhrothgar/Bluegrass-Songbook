# Chord Explorer

A standalone page (`docs/chord-explorer.html`, linked from the search facets) where users
build a chord progression on a beat grid, hear it through Web Audio, and loop it. It is not
part of the song page or the lead-sheet editor, and it has no unit or e2e tests.

- `theory.js` is pure music theory (chords for a key, voicings as MIDI, resolutions);
  `grid.js` holds the data model (`ChordGrid`) and the DOM view (`GridView`);
  `synth.js` is the synth; `main.js` wires the page. Read the files for the API.
- Grid state persists in `localStorage['chord-explorer-grid']`.
- Audio must start inside a user tap: `synth.js` creates its `AudioContext` lazily and calls
  `unlockAudioContext` (`../audio-unlock.js`, the iOS rule: resume synchronously in the tap,
  never after an `await`). Keep new play paths going through `getSynth()`.
- Its chord naming is its own (`theory.js`) and is separate from `../chords.js`
  (transposition, Nashville numbers). Do not assume the two agree on spelling.
