# Renderers

SVG tablature rendering and audio playback for OpenTabFormat (OTF), plus the
shared ChordPro renderer. `ls docs/js/renderers/` is the file list; what is not
obvious from it:

- `chordpro.js` is THE ChordPro renderer (`parseChordPro`, `renderSectionsHtml`,
  `renderSectionsAscii`, `renderSectionsPrintHtml`), shared by every lead-sheet surface.
- `measure-timing.js` is the time-signature-aware measure math shared by the
  renderer, player, work-view and the OTF editor (`expandNotation`,
  `readingListTimeline`, `measureTimingFromOtf`). Do not redo measure math
  elsewhere.
- `tab-hit-test.js` (`positionFromSvgPoint`) lives here, not in `otf-editor/`,
  so click-to-play in the reading view does not load the editor.
  `otf-editor/cursor.js` re-exports it.
- `otf-tracks.js` (`isPercussionTrack`, `pitchedTracks`) is the one "is this
  track pitched" filter. A drum track's `s` is a kit line, so `tuning[s-1] + f`
  is nonsense. Never sniff track names (one drum track is named "Guitar
  Standard"). The song page still shows a greyed `.percussion-track`
  placeholder; see `docs/js/CLAUDE.md`.
- `index.js` is a registry (`RENDERERS`, `getRenderer`, `detectFormat`; the key
  for OpenTabFormat is `otf`). `work-view.js` no longer imports it; it loads
  `tablature.js` and `tab-player.js` lazily. Do not add a static import of
  either to the boot graph (`docs/js/CLAUDE.md`, "Lazy modules").
- `tab-ascii.js` is legacy ASCII tab; rarely used.

```bash
npm test -- tablature                  # unit tests
npm run test:e2e -- work-view.spec.js  # tab rendering end to end
```

## TabRenderer (`tablature.js`)

One `TabRenderer` draws exactly one track into one container:
`renderer.render(track, notation, ticksPerBeat = 480, timeSignature = '4/4',
timing = null)`. There is no `setTrackVisibility`. Multi-track works build a
renderer per track, and `work-view.js` shows/hides the containers (the "View
track" selector) and mutes via the player. Sight and sound are separate:

- View-track tabs choose which staff you see; they do not touch audio.
- Mixer checkboxes (`.track-checkbox`) call `player.setTrackEnabled(trackId,
  enabled)` live, mid-playback. Muting does not hide the staff.
- Solo (`.track-solo`, on the renderer's track-info row) is audio-only.
- Percussion is excluded from mixer and playback (`pitchedTracks`).

Playback highlighting is keyed by absolute tick, not measure or note index:
`highlightNote(absTick)`, `clearNoteHighlight`, `updateBeatCursor`,
`resetPlaybackVisualization`, `destroy`.

### Layout invariants

- Repeats are expanded before drawing (`prepareCompactNotation` then
  `expandNotation`, driven by `readingListTimeline`, called from work-view).
- Rows hold several measures in one SVG (`measuresPerRow`, `'auto'` default).
  With `uniformMeasureWidth` (default true) every measure gets the same slot so
  barlines line up row over row; a short measure (pickup, mid-tune 2/4) uses its
  own fraction of the slot, pushed right so its last tick lands on the barline.
- Tick 0 is the start of the note area in every full measure, with no
  per-measure centering (fix-it item A17). Centering put an empty bar's tick 0
  mid-measure, pushed rests past the barline, and overran the editor's
  ruler/cursor, which share the mapping. Every consumer reads
  `noteX0 + noteOffset + tick / ticks * noteW`; `noteOffset` is only a short
  measure's right-alignment. `otf-editor`'s `automation.check()` enforces this.
- The free-text band and the effects band above the staff are reserved
  uniformly and only when the tab uses them (`fxLanesFor()`, one scan per
  render), so a tab without them renders byte-identically to before.
- Time signatures and rests are engraved with Bravura (SMuFL) when loaded,
  bold-serif digits otherwise. A tab must draw once per open:
  `renderTablaturePart` starts the font load with the tab JSON and waits up to
  250 ms (`TabRenderer.whenBravuraReady`); a late font triggers a redraw only if
  the draw was made without it (`_drewWithBravura`; the font promise resolves on
  a microtask even for an already-loaded font, which used to redraw every staff
  on every open). The font URL is pinned (`TabRenderer.BRAVURA_URL`, release tag
  `bravura-1.482`) because `@latest` on jsDelivr's `gh` endpoint is the repo's
  HEAD. Test: `__tests__/tablature-bravura.test.js`.

### Rhythm: stems, beams, flags, rests

`renderStemsAndBeams` has three beam levels in ticks: 1 eighth, 2 sixteenth,
3 thirty-second. Beam rects carry `data-beam="<level>"`.

- A note's level is the max of its written duration, its position (odd 16th
  slot, or a 32nd grid point off the 16th grid) and the gap to the next note.
  Positions count only on real 32nd grid points, so an undetected triplet at
  160/320 never grows a third beam.
- Beamable (`_beamRuns`): the gap to the next onset, or the written duration
  when that is shorter. Never longer, because banjo notes are routinely written
  to ring past the next onset.
- Rests (`restGlyphSequence(len, start)`): each rest is the largest value that
  fits and starts on a multiple of itself (1440 ticks from beat 2 is a quarter
  rest then a half rest). `restSpansForMeasure` also draws the measure's
  leading silence. The OTF editor's automatic duration depends on this: OTF
  stores no rests.

### Marks

Per-note `fx` and `grace` (format: `otf-editor/DESIGN.md` "interface Note")
draw in four places so stacked marks never land on each other, on H/P/sl labels
or on a chord neighbour's digit (strings are 14 px apart and chips 14 px tall,
so there is no room for labels inside the staff): on the fret (ghost, harmonic),
on the staff (staccato dot), left of the column (brush, roll; one per column),
and in the band above the staff (point lane for choke/tap/slap/vibrato/
bend-release; run lane for let-ring and muted). Classes are `.fx-<name>`,
`.grace-note`, `.grace-arc`, `.grace-label`. A grace has no tick: it sits in the
gap the layout left, shrinking to 5 px and dropping its background chip rather
than blanking a neighbour's digit. A run breaks at a column without the effect
and re-labels on a new row. The brush arrow direction is not decoded yet.

Slurs and ties: `renderSlurs()` runs once per row, after every measure in the
row is laid out, so arcs cross barlines freely. Pairing is musical (the
immediately preceding note on the same string), with no pixel-distance gate (a
fixed cap once ate any technique spanning a quarter note or more). The
limitation is ROW boundaries: a tie whose source is on the previous row draws an
incoming half-arc from the margin (`.tie-arc-in`); a technique draws nothing.
So "slur not rendering" usually means the source note is on the previous row.

## TabPlayer (`tab-player.js`)

The constructor takes no arguments. The OTF and options go to `play(otf,
{trackIds, tempo, transpose, loop, startTick, endTick, feel, countInBeats})`;
progress comes from assignable callbacks, all keyed by absolute tick:
`onTick`, `onNoteStart`, `onNoteEnd`, `onBeat`, plus `onPositionUpdate(elapsed,
total)` and `onPlaybackEnd`. Other methods: `loadInstruments(tracks)`, `stop()`,
`setTrackEnabled`, `setMixerSettings`. There is no `pause()`, `setTempo()` or
`seekToMeasure()`; tempo and range are `play()` options and the UI re-seeks by
stopping and restarting.

- Sound is WebAudioFont soundfonts (`INSTRUMENTS`, `WEBAUDIOFONT_URLS`,
  `getInstrumentKey(instrumentType)`), not oscillators. The only oscillator is
  the metronome click (`playMetronomeClick`).
- `ticks_per_beat` is 480 across this corpus and the default in renderer and
  player.
- Audio must stay synchronous inside the tap (`audio-unlock.js`): never make
  Play wait on an import, which is why `TabPlayer` loads with the renderer.

Techniques: a tie continuation never re-attacks (`applyTieExtensions`); `h`/`p`/
slide targets are one pick whose source rings on and glides (`absorbLegato`,
`legatoWaypoints`); `x` is a short damped chop; `b` bends a quarter tone. All
pitch moves use WebAudioFont `slides` waypoints (8th arg of `queueWaveTable`).

Effects and grace (fix-it item A15) follow TablEdit's playback. The logic is pure
exported helpers (`fxDurationVolume`, `strumOffsets`/`applyStrumOffsets`,
`soundingMidi`, `noteAttacks`) so `play()` only queues what they return; the
tunable constants are named and exported at the top of the fx block, so tune
there and read them for the numbers (brush/roll spacing, ghost gain, harmonic
intervals, ...). Rules that are not obvious from the constants:

- Brush and roll strum a chord column (same track and tick) from the low string
  (highest `s`) to the high; the first attack lands on the written tick.
- Let-ring rings to the next note on the same string, ignoring the rhythmic
  cut-off and the instrument chop rules (the `bass`/`guitar` branches in
  `play()` that shorten ring-model notes). Open-ended playback extends its end to
  cover a ringing note so a final let-ring chord is not cut by `stop()`.
- `muted` is a pitched palm mute, not `tech: 'x'` (the pitchless chop).
- Natural harmonics sound at the overtone above the OPEN string (12 is +12,
  7/19 +19, 5/24 +24, 4/9/16 +28, 3 +31); other frets are fretted +12.
- Grace (`note.grace`, on the MAIN note) sounds a 1/32 note or 45 ms (the
  shorter) before the main note on the same string, and the main note never
  moves. `kind: 'hp' | 'slide'` (every grace in the Banjo Hangout corpus) is one
  pick: the grace steps/glides into the main pitch and the main note is not
  re-attacked; any other kind is two attacks. Grace takes `transpose`, rides on
  the main note's record so play-from-cursor clipping keeps or drops both, and
  highlight callbacks fire on the main note's `absTick`.
- Combining: gains multiply; let-ring sets length first, then muted/choke/
  staccato can still shorten it. One pitch shape per attack, by precedence:
  legato legs (`note.legs`: one `{toMidi, atTick, glide}` per h/p/slide target
  that `absorbLegato` records on the source note), bend-release, choke, `tech: 'b'`, vibrato. Tremolo re-picks carry
  none.

## No instrument emoji in the tab UI

Unicode has a banjo, a guitar and a violin and nothing for mandolin, upright
bass or dobro, so those rendered as a generic guitar. The mixer also picked the
icon from `track.instrument` while the label came from `track.id`, so a track
with id `guitar` and instrument `5-string-banjo` showed a banjo beside the word
"guitar". The tab page uses text labels ("View track", a speaker glyph for the
Sound row). Don't reintroduce per-instrument emoji.

## Common issues

- Notes clustered in the first half of a measure: the time signature was not
  passed as the 4th argument to `render()`.
- Wrong playback speed: `ticks_per_beat` in the OTF metadata does not match.
