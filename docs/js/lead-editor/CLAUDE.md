# Lead-sheet editor (`lead-editor/`)

One CodeMirror 6 view whose document is the ChordPro text. Three modes share one
document, one undo history and one caret. Spec:
`docs/plans/2026-10-26-lyrics-editor-redesign.md`.

| Mode | Job | CodeMirror state |
|---|---|---|
| Lyrics | write, paste, mark sections | decorations on, editable; chords drawn but inert |
| Chords | place / change / move / delete chords | same decorations, `editable` false, `user-select:none` |
| ChordPro | edit the source | source highlighting, editable, beside a read-only preview |

- `index.js` owns the three-way mode; `cm-editor.js` only knows two decoration sets
  (`buildVisual` for Lyrics and Chords, `buildSource` for ChordPro) plus `setEditable`.
- The mode is remembered per device in `localStorage['bgb-lead-mode']`
  (`lyrics|chords|chordpro`; the old value `visual` means `lyrics`). A song opened with
  `setText(text, {reset:true})` gets the remembered mode; a new empty song always opens in Lyrics.
- Lyrics and Chords reuse the book's own classes (`.song-body`, `.song-section`,
  `.cl-line`, `.cl-segment`, `.cl-chord`), so the look matches by construction. The e2e
  compares `.cl-segment` widths against `#work/old-home-place`.
- CodeMirror is vendored (`docs/vendor/codemirror.js`, rebuild with `./scripts/vendor-codemirror`).
  It must be reached only through `editor.js`'s lazy import, never from `main.js`'s static
  graph. `docs/js/__tests__/lazy-modules.test.js` enforces this; a new module goes in
  `LAZY_MODULE_URLS` (`docs/js/lazy-modules.js`).
- Shared code outside this directory: `chordGlyphHtml` in `../chords.js`,
  `../visual-editor/{model,syllables,wrap-section}.js`, `../smart-paste.js`.
  `chordGlyphHtml` always escapes chord text. Never put chord text into `innerHTML` any
  other way; section labels use `textContent`.

`doc-model.js` is pure text rules and the single owner of the song key (`currentSongKey`).
`chord-motion.js` holds the cursor-motion tuning constants. `index.js` is the controller and sets
`host.__lead` (a test hook). The other files are named for their job.

## The controls band: one place, every device

Decided by Mike on 2026-10-28. `index.html #editor-band` holds `Lyrics | Chords | ChordPro`
(`#editor-mode-*`), ↶ ↷ (`#editor-undo/redo`), the key (`#editor-transpose-group`: −
`#editor-key-select` +) and a Display pill (built with the shell's `pill()`; it takes
`#editor-display-options`: A− / A+, Nashville, "Clean up pasted chord sheets" `#editor-auto-detect`).
No other part of the editor carries a copy of these (the chord picker had all three until then).

- `editor.js::showEditorBand()` mounts it in the app's bottom band whenever `main.js` shows the editor
  view. Leaving the view clears the band, which detaches the element without destroying it, so
  listeners and state survive (`syncModeChrome` looks in the detached band too). The elements are
  moved, never rebuilt: their ids hold. It and `hideEditor()` also put Chords mode's picker back
  and away (`api.setOnScreen`; "Leaving the editor view" in `CHORDS-MODE.md`).
- On a phone (`split`) the picker sits on the band (`bottom: var(--bottomband-h)`); `visibleGap()` and
  the docked section bar (`placeDockedBar`) stop at it. The band is one row from 360px up (≤480px hides
  − / +; ≤400px tightens the switch); at 320px it wraps, and everything stacked on it reads
  `--bottomband-h`. e2e: "one place for the controls", "the editor's controls band"; helpers `BAND`,
  `openDisplay` in `e2e/helpers/lead-editor.js`.
- **The key: one per song.** Choosing a key in `#editor-key-select` moves the whole song
  (`editor.js::songInKey`): every chord shifts by `doc-model.js::keyShift(from, to)`, the nearer way,
  comparing keys through their relative majors (G → A is +2; G → Em is 0, only the name changes, which
  is how a mis-detected mode is fixed), and `{key: to}` is written, one undo step. A song with no
  chords gets only the declaration. The chord panel's `.chm-key` is a label ("Key of G", "Key: not
  set"). `currentSongKey` feeds the panel, the band and the submitted `key`/`mode`.

## Rendering traps

- **No vertical margin inside the editor.** CodeMirror's height map ignores margins, so a
  `margin-bottom` on `.cm-line` or on a block widget drifts the map away from the screen
  (112px by Verse 3 of old-home-place); `posAtCoords` then hits the wrong line. The editor
  stylesheet turns the book's spacing into padding (`.le-cm .cm-line.song-line`,
  `.cl-last`) and block widgets use `display:flow-root`. `lead-editor-cm.test.js` fails if a
  vertical margin comes back.
- **Widget buffers.** CodeMirror puts zero-width `img.cm-widgetBuffer` around inline widgets. Only
  the first child of a `.cl-segment` (the buffer before its `.cl-chord` label, which sits above the
  lyric) is taken out of flow, via `position:absolute` in `style.css`; in flow it adds a phantom row.
  The others must stay inline: absolute ones made iOS WebKit give a segment a third row after a
  font-size change ("staircase"), and `display:none` breaks `coordsAtPos`. Reproduces only in
  Playwright WebKit; the Chromium e2e checks the cause ("no staircase inside a word").
- **Native selection only** (no `drawSelection()`, no custom `::selection`): iOS drew a second one.
- **`.le-cm .cm-scroller` is `overflow-x: clip`.** CodeMirror's `measureTextSize` inserts a 99999px
  line that briefly widened the page, and phones answered by resetting scroll to 0.
- **Back-to-back chords** (`[A][D]Charlottesville`): the first has no lyric, so its glyph touches the
  next. Such a segment is `.cl-segment.cl-before-chord` (padding-right 1ch), set by both
  `renderers/chordpro.js` (`renderLine`) and the editor (`ChordWidget` `beforeChord`). Change both.

## Lyrics mode

- Backspace deletes the letter and hops over chords; Delete mirrors it. A selected range
  deletes the chords in it and a toast says "Removed N chords - Undo".
- Text typed or pasted where a chord sits goes before it (`typingRulesFilter`; `Programmatic` edits skip it).
- **Protected text.** Metadata and section directives are protected by the document, not
  by how they draw. `protectedSpans(text)` covers every line `analyzeDocument` calls hidden,
  label or locked. `protectDirectivesFilter` clips any user delete / replace / paste / move /
  drop to the unprotected pieces (`doc-model.js::clipDeletion`). Exceptions: a section lying
  wholly inside the range goes too, `{start_of_*}` to `{end_of_*}` (`freedSectionLines`), and
  the blank lines it leaves are tidied as one change. `{meta:}`, `{key:}`, other header
  directives and locked blocks (ABC / tab / grid) always stay; note rows are the exception (below). Edits through
  `editor.change` / `setText` (`Programmatic`) and undo/redo are exempt. Select-all + Delete
  leaves the metadata lines; select-all + paste puts the new text after them. For tests:
  replacing a song that has directives by select-all + typing keeps the directives (use
  `appendLead` in `e2e/helpers/lead-editor.js`).
- **Sections.** `wrapSelectionAsSection` (`../visual-editor/wrap-section.js`) re-sections across
  boundaries and renumbers `Verse N`.
- **Section bar placement.** Desktop floats it beside the selection; phones dock it above the keyboard (`placeDockedBar`), because iOS draws its own Cut / Copy / Paste menu where the floating bar sat and that menu always wins.
- **Label menu and undo toast stay in the visible area** (`index.js::visibleArea()`: below the top band, above the
  bottom band or keyboard via `visualViewport`, and in Chords on a phone between the magnifier and the docked picker).
  `placeLabelMenu` opens below the label; if it won't fit it first scrolls the label up (before the menu listens for
  pointerdown, since a finger scroll closes it), then scrolls inside itself. It runs again on `visualViewport` /
  window resize while the menu is open (`onViewportForLabelMenu`): on an iPhone the keyboard closes after the label
  is tapped. `.le-toast` takes no taps except its Undo.
- **Note rows** (`{comment: …}` lines; smart paste makes them from headings like `[Capo 2]`) are locked blocks, but
  unlike tab / ABC / grid blocks they can be removed from Lyrics: `freedSectionLines` frees one lying wholly inside
  a deletion, and tapping one (`LockedWidget` → `hooks.onComment` → `index.js::openCommentMenu`) offers an Edit
  field + Save (`setNoteText`) and Delete note. The section bar's **Note** turns every lyric line the selection
  touches into a note in place (`section-ops.js::noteSelection`, chords dropped). Each is one undo step. The row's
  line is read with `posAtDOM` at the tap: the widget is reused when text above it moves. e2e: "a note row".
- **Paste anywhere.** ⌘V / Ctrl+V anywhere on the editor page pastes into the song (`onDocPaste`, a document
  `paste` listener while the editor is on screen); a field that takes text itself (`input`, `textarea`, `select`,
  `contenteditable`) keeps its own paste, and Chords mode switches to Lyrics first. A new empty song on a fine
  pointer opens with the caret in the sheet (`focusIfEmpty`, via `editor.js::focusEmptyEditor`), never on a
  phone (it would raise the keyboard). Clipboard text is normalized to `\n` first (`clipText`,
  `convertPastedText`): CodeMirror drops `\r`, so a `\r\n` paste (an Ultimate Guitar copy) put the cursor past
  the end and the whole paste was lost. e2e: `editor.spec.js` "Paste just works".
- **Copy / cut / paste of whole sections.** Section markers are hidden widgets, so a browser copy of
  the lyrics lost them (a copied chorus pasted back as a verse). `handleCopy` (`index.js`) uses
  `section-ops.js::sectionsForClipboard`: a selection covering or crossing sections puts each touched
  section on the clipboard with balanced start/end lines; anything inside one section stays the
  browser's copy. A cut of whole sections is a user deletion, so the protect rules apply. Pasted text
  holding a section (`holdsSections`) lands between sections, never nested (`placeSectionPaste`).
  e2e: "copy and paste of whole sections".
- **Empty-sheet hint** (`.le-empty`) is a sibling overlay, not CodeMirror's `placeholder()` (that makes the node inert and killed the Paste button). Paste is offered only where `isSecureContext && navigator.clipboard.readText`; on plain http the hint says how to paste.

## Chords mode

- **The box** is a document position (`boxField`): the start of a syllable, after any chords
  already there, mapped through edits with `assoc 1`. Its shape is
  `{pos, active, after?, newLine?}`. `after: 1` is a virtual slot at the line end after the
  trailing chords; `newLine: true` is a pending empty chord line. Neither writes anything
  until a chord is picked.
- **Pointing.** `posAtCoords` picks only the line; `chords-touch.js::seamAtPoint` picks the
  seam whose syllable span contains x, using where it is really drawn (`coordsAtPos`). A tap
  on a chord glyph selects that chord; a tap on the rest of the chord row belongs to the lyric
  under it. A tap right of the last word opens the after-the-words slot.
- **Keys (desktop).** A capture `keydown` on `document` while in Chords mode (the locked chart
  cannot take focus): arrows, typed chord letters (ghost chip, 1.5s grace so `E` then `b7` is `Eb7`),
  Space/Tab, Delete/Backspace, Esc.
- **Hit spans** (`chords-touch.js::rowSpans`, used by `pickItem` and `pickStop`): a stop's span runs from its left
  edge to the next stop's, and one narrower than `MIN_HIT_PX` (24) borrows up to half the shortfall from each
  neighbour that stays at least that wide. Without it a one-space gap was a 5px target.
- **Stops, the glide, trailing chords and the chord panel** are in
  `CHORDS-MODE.md` beside this file. Read it before changing where the cursor
  stands (`lineStops`, `snapCursor`), how a finger glide moves it
  (`chord-motion.js`), how chords after the words are spaced, or the panel's
  `split` / `side` layouts and magnifier.

## The tour's hooks (`present`)

The feature tour plays a song into this editor (`../tour-editor-demo.js`) by pressing real
buttons. `api.present` holds the two things a pointer does that code cannot: `select(from, to)`
shows the section bar without focusing the editor (on a phone, focus raises the keyboard), and
`boxAt(pos)` puts the chord box on a syllable. `end()` and `setText(.., {reset:true})` clear
`presenting`.

## Text adapter
`editor.js` `getText() / `setText()` are the only way to read the song text (submit, copy, dirty
check, sign-in return record, transpose). If the editor cannot mount, a hidden `#editor-content`
textarea serves the same adapter.

## Tests

- Unit (`docs/js/__tests__/`, `npm test`): `lead-editor-*.test.js`, `chord-glyph.test.js`,
  `visual-editor-wrap-section.test.js`, `syllable-corpus.test.js`.
- E2E (`e2e/`): `visual-editor.spec.js` (desktop), `visual-editor-mobile.spec.js` (phone),
  `editor.spec.js`, `editor-lifecycle.spec.js`; helpers in `e2e/helpers/lead-editor.js`
  (`leadText()` reads the text adapter through `host.__lead`). The spec files keep their old
  `visual-editor` names.
- Not verifiable without a real phone: iOS autocorrect or dictation next to hidden chords, the feel of the glide constants, haptics, and fixed bars under Safari's collapsing address bar.
