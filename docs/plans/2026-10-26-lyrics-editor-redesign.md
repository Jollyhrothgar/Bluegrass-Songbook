# Lyrics & chords editor: one job per mode

**Date:** 2026-10-26 · **Status:** first build done (uncommitted, branch
`feature/redesign-lyrics-chords-entry`); reworking to three explicit modes
after the first phone test ·
**Fix-it list:** supersedes E3, touches E1 (one ChordPro core) and E2 (drafts) ·
**Mockup:** `design/ui-states/proposed/e3-chord-menu.html` (still draws the old A/B/C layouts)

## The problem

The lead-sheet editor shows two editors at once: the raw ChordPro textarea
and an interactive preview, side by side on desktop and stacked (raw first)
on phones. You can do most things two ways, and each way is incomplete:

- **Typing lyrics** happens in the textarea, as ChordPro. The preview edits
  lyrics one line at a time: a click swaps the line for a single-line
  `<input>`, so a pasted block loses its newlines.
- **Pasting** works only in the textarea. Smart paste (`smart-paste.js`) never
  runs from the preview.
- **Sections** come from a textarea selection (Make verse/chorus mini-bar) or
  from the preview's ⋯ menu, but the preview cannot make a section from lines
  you select.
- **Chords** go in from the preview's chord strip, which nothing in the
  textarea mirrors.
- **Neither pane looks like the song page.** The preview has its own
  renderer (chips, carets, syllable splits: the "go ne" gaps in E3).

## The proposal

One document, the ChordPro text, and ONE switch with three modes. Each mode
does one job, and only one is on screen:

| Mode | Job | What you touch |
|---|---|---|
| **Lyrics** | write words, paste, mark sections | text: native typing, paste and selection. Chords are shown, but inert |
| **Chords** | place, change, move and delete chords | the chord box and the chord sheet. The words are locked: no keyboard, no text selection |
| **ChordPro** | edit the source | the ChordPro text, beside a read-only preview |

Lyrics and Chords look exactly like the song page (the "book").

### Why three modes (decided 2026-10-26, after the first phone test)

The first build had no chord toggle. On a phone the keyboard was the mode:
keyboard up meant writing, keyboard down meant chord gestures (long-press
magnifier, flick, ♪/Aa keys, margin drag). Its first test on a real iPhone
found:

- two selections on screen at once, the browser's and ours;
- a selection across the end of a verse and the start of a chorus produced
  nothing;
- syllable taps too imprecise to use;
- a mode the user could not see.

Text editing and chord placement were fighting over the same gestures.
Explicit modes give every gesture one meaning. The keyboard-state machine,
the ♪/Aa keys, the magnifier and the margin drag are removed.

## How the book view looks exactly like the song page

The book draws a line as a row of inline blocks, one per chord. Each block
holds the chord on top and the lyrics up to the next chord underneath
(`renderers/chordpro.js` `renderLine`: `.cl-segment` › `.cl-chord` + text). A
wide chord over a short syllable pushes the following words apart, and a line
with no chords has no chord row. A plain textarea can hold neither, so the
editor is **CodeMirror 6** used the way Obsidian's "Live Preview" uses it for
Markdown. The document *is* the ChordPro text; Lyrics and Chords modes are the
same set of decorations over it:

| In the text | The book view draws |
|---|---|
| `[G7]` | hidden; replaced by a chord label, `<span class="cl-chord">G⁷</span>` |
| from one chord to the next | wrapped in `<span class="cl-segment">`, the book's inline block |
| a line with chords | the book's `.cl-line` class (no chords: a plain lyric line, no chord row) |
| `{start_of_chorus: Chorus}` | hidden; replaced by the book's section label |
| lines inside a chorus or repeated section | the book's indent |
| `{end_of_*}`, `{meta: …}` lines | hidden (title and artist live in the editor header) |
| `{start_of_abc}` … `{end_of_abc}`, `{comment}` | a locked block, as the book shows it ("edit in ChordPro") |

Because these reuse the book's class names and stylesheet, the editor looks
the same as the page by construction. It shows the book at its default
display settings, at your font size: all chords, one column, repeats not
collapsed.

What that buys:

- **Chords ride along with typing for free.** They are characters in the
  text.
- **Switching modes loses nothing.** All three modes are one document: the
  same undo history and the same caret.
- **The browser handles typing, autocorrect, dictation and IME composition.**
- **We have real geometry** (`posAtCoords` / `coordsAtPos`).

**The cost** is one vendored dependency: `docs/vendor/codemirror.js`
(state + view + commands; 282 KB raw, 92 KB gzip), rebuilt by
`scripts/vendor-codemirror`. It is lazy-loaded with the editor and cached by
the service worker.

## Lyrics mode

Writing, pasting and sections. The text is editable, and every text gesture
is the platform's own.

- **Chords are visible but inert.** They aren't clickable and the caret
  steps over them. The typing rules still protect them:
  - **Backspace deletes letters, never a chord** (`Ama[G]zing`, caret before
    "z": Backspace deletes the "a").
  - **Text typed where a chord sits goes before it**, so the chord stays on
    its syllable.
  - **Deleting a range that holds chords removes them**, as one undo step,
    with a toast ("Removed 3 chords — Undo").
- **A new song** opens on an empty chart: "Type or paste your song", plus a
  Paste button. Pages may only read the clipboard over HTTPS (or on
  localhost). Where the button can't, it focuses the editor and says "Press
  and hold, then Paste".
- **Paste** runs `convertPastedText` and inserts the ChordPro it produces, so
  a chords-over-lyrics sheet arrives as a rendered chart with its sections.
  An empty title and artist are filled from the paste.
- **Sections**:
  - **Mark**: select any part of one or more lines and a bar floats next to
    the selection: `Verse · Chorus · Bridge · Intro · Outro · Tag · Other…`.
    The selection extends to whole lines and is wrapped by `wrap-section.js`.
  - **Across sections**: a selection that crosses section boundaries is
    re-sectioned. The labels and boundaries inside it are replaced by the
    new one.
  - **Change**: tap a section label to rename it, change its type, duplicate
    it, move it up or down, remove the label, or delete the section.
- **No shortcut into Chords** (revised 2026-10-27): only the mode switch enters
  Chords mode, on every device; a double-click selects a word. Chords are greyed
  in Lyrics mode. A section wholly inside a deletion goes entirely (label and
  end), metadata and locked blocks stay.

## Chords mode

Placing, changing, moving and deleting chords. The words are locked: the
editor is not editable, there is no text selection, and no keyboard on a
phone. That is what ends the gesture fights.

- **The chord panel is always there, docked, never floating** (revised
  2026-10-27, after the fourth phone test):
  - **Phone: split in two.** The magnifier (the enlarged current line with
    ◀ ▶ ▲ ▼) docks at the TOP of the screen, above the song. The chord
    picker (decorations, the in-key and outside rows, More roots, Add chord
    line) docks at the BOTTOM. The song scrolls between them, and both
    parts keep a fixed height.
  - **Desktop: a docked panel to the right of the song**, sticky as the
    chart scrolls, holding the magnifier and the picker. A window too
    narrow for the side panel docks it at the bottom, as on a phone. The
    floating popover anchored to the box is gone.
- **Phone controls live in the lower panel** (revised 2026-10-27, after the
  sixth phone test). The picker's first row is **Key ▾ … Lyrics | Chords |
  ChordPro**, so switching modes never needs the editor header (which sits
  under the magnifier). Done is gone, because Lyrics does that. The second
  row carries the function line, Move / Remove when the cursor is on a
  chord, and ↶ ↷ undo / redo. Both rows keep a fixed height.
- **The magnifier is OFF by default** (revised 2026-10-27). It is an
  accessibility option, toggled from the panel's nav row and remembered
  per device. The chart itself can be enlarged with the editor's A− A+
  controls instead. Those share the song page's font-size setting.
- **The arrows live in the bottom panel**, in one nav row: **◀ ▲ ▼ ▶ … ↶ ↷
  and the magnifier toggle**. This applies whether the magnifier is on or
  off, so they are never in two places.
- **The magnifier, when switched on, is compact**, about 20% shorter than the first split
  build. It must always sit fully below the app's top bar, never partly
  behind it.
- **The syllable under the cursor is always highlighted**, however the
  cursor got there: a tap, a glide started from the chord row above the
  words, the arrows, or the magnifier.
- **Aim**: tap or click a lyric, or the chord row above it, and the box
  snaps to the nearest seam (a syllable start from `syllables.js`, a word
  start, or the line end). The line is picked by height, and a chord row
  belongs to the lyric under it. Then the seam is the nearest one along the
  line. The tap only has to be near the word.
- **Fine-tune with the trackpad strip** across the top of the sheet:
  - The current line, enlarged, with the box on it.
  - Dragging anywhere on the strip moves the box seam by seam, with a haptic
    tick where the phone supports one (`navigator.vibrate`), the way holding
    the iPhone space bar moves the cursor. Your finger never covers the
    lyric you're aiming at.
  - ◀ ▶ step one seam, and ▲ ▼ step one line.
- **Place**: tap a chord in the sheet. If the box already holds a chord, it
  is replaced. Decorations change the chord in the box.
- **Select**: tap a chord on the chart and the box lands on it. The sheet
  shows **Remove** and **Move**. Remove deletes the chord, as one undo step.
  Move carries it, so the strip and the arrows move the chord as well as
  the box. Tap Move again, or tap elsewhere, to drop it.
- **Keyboard (desktop)**:
  - Arrows move the box.
  - Typing a chord letter starts typed entry (the ghost chip: about 800ms
    idle auto-commit, Enter commits, a 1.5s resume grace so `E` then `b7`
    gives `Eb7`).
  - Space and Tab advance.
  - Delete or Backspace removes the chord in the box.
  - Esc closes the sheet.

### Moving the chord cursor: glide, like the iPhone space bar (decided 2026-10-26, revised after the third phone test)

The chord cursor (the box) moves smoothly and precisely under a drag. It
never moves the text caret.

- **A long press anywhere starts the glide**, about 0.3s in Chords mode:
  - On the chart, the cursor first jumps to the finger, then glides. If the
    press is on a chord, the glide carries that chord.
  - On the chord sheet, the sheet turns into a trackpad (the buttons fade)
    and the cursor glides from where it is, like the iPhone space bar.
  - A short tap keeps today's behaviour (move the box; press a button).
- **It follows the screen, not the text.** The glide moves a virtual point
  in SCREEN space by the finger's movement times a gain: low when slow
  (precise), higher when fast.
  - The cursor snaps to whatever is under that point: the nearest letter
    when moving slowly, the nearest syllable seam when fast.
  - Past the end of a drawn row, the point lands in that line's slots after
    the words.
  - Moving down goes to the next row you SEE, so a line that wraps onto two
    rows behaves as two rows, never as one long line.
  - The same hit-testing as a tap (`seamAtPoint`) is used, so a glide and a
    tap always agree about what is where.
- **One place per letter.** The spot just before a chord and the spot
  just after it are the same letter on screen. A cursor that arrives at a
  letter carrying a chord selects that chord (Move / Remove). It never
  shows an empty slot beside it, and never stacks a second chord there.
- **The strip** (the enlarged current line) drives the same point.
- **Haptics and lifting**: each syllable seam crossed gives a light haptic
  tick where available. Lifting sets the cursor, and the next chord tapped
  goes there.
- **The strip keeps the cursor fully in view**, centred when it can be.
- **Decided 2026-10-27 (drift, lift, thumb):**
  - **The chart glide is 1:1 with the finger.** The gain and the clamp made
    it a relative trackpad: a fast 300px swipe moved the point 720px and the
    overshoot was thrown away, so the offset was permanent. The glide now
    "responds to the physical screen area": the point IS the finger, and the
    chart's edge clamps only the hit-test. The gain stays for the two real
    trackpads (holding the sheet, dragging the strip).
  - **A lift commits what was shown 80ms earlier** (`SETTLE_MS`), when a
    newer stop appeared inside that window: a thumb's contact point slides
    a few px as it lifts, enough to cross a syllable. Touch and pen only.
  - **The occlusion aid is the pop-up loupe**: a bubble above the thumb with
    the cursor's line magnified, like the iPhone keyboard's key pop (mockup
    `design/ui-states/proposed/e4-thumb-aim.html`, idea A). Chosen by the
    owner over aim-above, a knob, a lift-line and a scrub bar.
  - **A glide picks the stop the finger is IN, like a tap** (as the mockup
    did), sticky for a few px past each edge. Picking the nearest stop start
    boxed "body" while the finger, and the loupe's tail, sat in "some".
  - **Nothing scrolls the page under the finger during a glide**; the lift
    scrolls once if the line needs it. Found while reviewing: the per-move
    scroll-into-view ran away over the picker (783px for a 1px wiggle), and
    CodeMirror's 99999px-wide measuring line widened the page for an instant,
    which reset a phone's scroll to the top (now clipped).
  - **The "staircase" (iOS only)**: with the cursor mid-word after A+ / A-,
    WebKit drew one segment as three rows (D / some / body). Cause: an
    absolutely positioned CodeMirror widget buffer mid-word. Only the buffer
    before a segment's chord is taken out of the flow now; reproduced and
    fixed in Playwright WebKit, guarded by an e2e in Chromium.
  - **Chords after the words: the GAP you see is 3, not the spaces before
    each chord.** The spaces after a chord are its lyric in ChordPro, so a
    flat 3 left 3 minus the chord's width (C♯⁷ then D touched). Each chord is
    now followed by its own length + 3 spaces (`home   [C#7]      [D]    [A]`),
    which reads even in any ChordPro app. The owner chose this over drawing
    old songs evenly in the renderer: existing tails (about 2,000 lines,
    spaced every which way) change only when their slots are edited.
  - **The gap is 2, not 3** (owner, after trying it): chords after the words
    and on chord lines are written `home  [D]   [A]` (each chord's length +
    2 after it). Back-to-back chords on one syllable (`[A][D]...`) get one
    character of air on the song page and in the editor (they drew "AD").
  - **Phones dock the section bar above the keyboard** (Lyrics mode). It
    floated above the selection, exactly where iOS draws Cut / Copy / Paste,
    so it was there but covered. Desktop keeps it floating.
  - **The empty slot after the words is highlighted like a syllable**: the
    dashed chord box AND an outline on the lyric row (owner's request). And
    it no longer flickers against the last word: the slot was measured from
    the cursor's own zero-height widget whenever the cursor stood in it.

### Where the cursor stops (decided 2026-10-27, after the fifth phone test)

The cursor stops in three kinds of places, and never on an individual
letter. Letters only smooth the glide.

| Stop | Where | Cursor shape | Placing D writes |
|---|---|---|---|
| **Syllable** | a syllable start, or a chord already sitting mid-word | outline box on the syllable | `[D]hollow` |
| **Between words** | the space between two words, for a change on a held note or a rest | a slim bar in the gap | `years[D] since` (the chord sits over the space) |
| **After the words** | past the last word: turnarounds, fills | the dashed slot | `home   [D]    [A]` |

- **The glide** moves its ring continuously with the finger, letter by
  letter, so it feels connected. The cursor only lands on stops, with a
  little hysteresis so it doesn't flicker between two neighbours. Each
  change of stop gives a tick.
- **◀ ▶ step stop to stop** in reading order: syllables, then the gap,
  then the next word, … the last word, then the after-the-words slots. No
  mode change.
- **A cursor anywhere else** (mid-syllable, left by an edit, undo or a
  mapping) snaps to the nearest stop, in the same single normalisation
  step that keeps it off the wrong side of a chord.
- **Slots after the words are evenly spaced** (decided): every chord there
  is written with the same fixed gap of **three spaces**, also before the
  first one, so a turnaround reads evenly on the song page.
  - **The corpus** mostly uses one space. That's 98% of the 1,192
    chords-only lines and 72% of the 5,733 lines with chords after the
    words, measured 2026-10-27.
  - **Three spaces** was chosen anyway (owner, 2026-10-27), because one
    space renders chords touching on the song page.
  - **Existing lines** keep their spacing unless edited. Their
    run-together rendering ("AD") remains a separate fix-it item. Spacing doesn't show
  timing; that would need a beat or bar concept the editor doesn't have.
- **↵ (chord line)** in the sheet continues onto a new chords-only line
  directly below the cursor's line, with the cursor on its first slot,
  like Enter while typing. It replaces the separate "Add chord line"
  button. A chords-only line uses the same evenly spaced slots, so writing
  changes at the end of a line and spilling onto a line of only changes is
  one continuous motion.

### Syllables (decided 2026-10-27)

**The problem.** The old splitter cut at every separate vowel group, so
silent-e words split (ho·me, lo·ve, ti·me, the·re). It split 33 of 44
common one-syllable words, and missed compounds (for|ever, every|thing,
with|out).

**The new splitter.**
- **Base: Liang hyphenation patterns**, the standard TeX/browser method,
  US English, vendored.
- **Lyric rules on top**, for word edges the patterns refuse:
  - a leading lone "a" or "o" before a consonant (a·way, a·gain, a·lone,
    a·round, o·ver, o·pen);
  - "to" prefixes (to·night, to·day, to·geth·er).

**Measured against the corpus.** The test set is the 21,053 chords that
existing charts place inside a word.

| Splitter | Matches human placements | Common one-syllable words split |
|---|---|---|
| Old vowel-group rule | 67.3% | 33 of 44 |
| Patterns + lyric rules (prototype) | 71.0% | 0 of 44 |

**Kept:**
- seams at chords already inside a word;
- seams at hyphens in the lyric.

**Not used:** the song page never uses syllables.

### Chords after the words (decided 2026-10-26)

Turnarounds and fills that belong to a verse stay ON the verse's line, in
the same chord row as its other chords (`…left my [A]home [D] [A]`), exactly
as the book draws them. Standalone intros and breaks get their own chord
line.


- **Slots after the words**:
  - **Stepping or gliding past a line's last word** (or past chords that
    already trail it) opens a fresh empty slot.
  - **Picking a chord there** appends it after the words (`…home [D]`), and
    the cursor jumps to the next new slot. Tapping D then A gives
    `…home [D] [A]`.
  - **An empty slot you leave writes nothing**: no stray spaces.
  - **Tap past the end of a line**: tapping the empty space to the right of
    a line's last word puts the cursor in that line's next empty slot.
- **Chord lines**:
  - **Add chord line** in Chords mode inserts a row with no words below the
    cursor's line, in the same section. It is for a standalone kickoff or
    instrumental break, never for a verse's own turnaround.
  - **Tapping chords appends them in order** (`[G] [C] [D7] [G]`).
  - **The song page draws it** as a chords-only row, as it already does for
    the 236 lead sheets that have them.
  - **A chord line you leave empty is removed again.** Removing its last
    chord removes the line.

### The chord menu

ONE layout (decided 2026-10-26; the A/B/C comparison and `?chordmenu=` are gone).
Show only what is needed to make a chord: extensions are implied by a
decorations row, so no cell is a G6, Gsus2, Gdim7 or D7. Rows, bottom (nearest
the thumb) to top:

1. **Diatonic triads** of the key with numerals. G: G(I) Am(ii) Bm(iii) C(IV)
   D(V) Em(vi) F#dim(vii°). In Em: Em(i) F#dim(ii°) G(III) Am(iv) Bm(v) C(VI) D(VII).
2. **Flipped quality**, same root, same column. G: Gm(i) A(II) B(III) Cm(iv)
   Dm(v) E(VI), and the vii° column holds F(bVII) (a single data entry the
   owner may revise). Em: E(I) F#m(ii) Gm(iii) A(IV) B(V) Cm(vi) Dm(vii).
3. **Decorations**, hidden until the box holds a chord: bare marks
   `⁷ maj⁷ ⁶ ⁶⁄₉ add⁹ sus² sus⁴ ⁹ /bass`. A decoration applies to the base chord in
   the box and composes with its quality (Am + ⁷ = Am7, D + ⁷ = D7, A + maj⁷ =
   Amaj7, Dm + ⁶ = Dm6, G + sus⁴ = Gsus4); the active one is highlighted;
   tapping it again removes it; one extension at a time; `/bass` opens a bass-note picker.

**Every chord and every extension appears exactly once** (decided
2026-10-26, after the second phone test). Strum Machine is the model for
disclosure: a root is chosen once and a type is chosen once. Our visual
design is kept, and in-key versus outside-the-key is made unmistakable.

- **In key** (row 1) is drawn solid and strongest.
- **Outside** (row 2) has its own outlined, muted style. Both rows are
  labelled.
- **More roots ▸** reveals only the chromatic roots that appear nowhere on
  the grid, as major and minor cells in outside styling with numerals. In
  Bm those are C, D♯/E♭, F, G♯/A♭ and A♯/B♭. The free-text "Any chord"
  field stays here as a last resort.
- **Extensions** live only in the decoration row. Rarer ones (⁶ᐟ⁹ ¹¹ ¹³ °
  ø⁷ + m(maj⁷)) open inline behind **⋯**, and the row ends with **/ bass**.
- **/ bass** is one row of the 12 bass notes: the key's notes in in-key
  styling, the rest outside.
- **Removed**:
  - the old "More chords" root grid;
  - the per-root quality grid (D Dm D⁷ Dmaj⁷ …);
  - the "Also in this song" strip.

  Used chords keep a dot on their grid cell.

**In key is decided per chord, not per row, and functions are always
shown** (2026-10-26):

- **No caption labels.** Styling alone carries in-key versus outside.
- **The test is the whole chord.** A chord is in key when every chord tone
  is in the key's scale (harmonic minor's raised 7th allowed, so B⁷ is in
  key in Em). In G, D⁷ and Cmaj⁷ are in key; G⁷ and A⁷ are not.
- **Extension buttons are styled by the result.** Each one shows whether the
  box chord with that extension is in key: with G in the box, maj⁷ is solid
  and ⁷ is outlined.
- **Every cell carries its Roman numeral**, the extra roots included.
- **The chord in the box shows its full function once**, in the sheet
  header, so a secondary dominant is named while you chord by ear: "A⁷ ·
  II⁷ (V⁷/V)". This is the hint Strum Machine lacks.
- **The chart is not tinted.** The highlighting lives in the sheet only.

**The key: decided 2026-10-28 (Mike).** One key per song, changed in one
place, the toolbar, and changing it moves the whole song: every chord, plus
`{key: …}`, one undo step (the relative minor only renames: G -> Em moves
nothing). The sheet shows the key and does not change it ("the chord UI is in
service of editing the song, which has a selected key"). Songs with real key
changes are dealt with later, and nothing here blocks charting one: any chord
is reachable from More roots or by typing. One function, `currentSongKey`,
still feeds the sheet, the toolbar and the submitted key.

### Chord glyphs (book and editor alike)

`chordGlyphHtml()` (in `chords.js`) draws ♯ ♭, superscript extensions, and
° ø + (`F#m7b5` → F♯ø⁷). It is used by the song page, the editor's chord
labels and the menu. It is display only: the file stays ASCII.

**It always escapes the chord file's own text** (stored-XSS regression test
in `chord-glyph.test.js`).

## ChordPro mode (decided: the preview is read-only)

- **Desktop**: the source on the left, in the same CodeMirror view with the
  decorations off, so chords are coloured and directives dimmed. On the
  right is a read-only preview drawn by `renderSectionsHtml`, the song
  page's renderer.
- **Phone**: the source fills the screen, and a `Source | Preview` toggle
  swaps it for the preview.
- **Kept**: smart paste, the auto-detect checkbox and the ChordPro hints.

## Shared chrome

- Top: the metadata line (title — artist), the **`Lyrics | Chords |
  ChordPro`** switch, undo/redo, and the key with − / + transpose (one
  transaction, so one undo step).
- Bottom: Copy · Download · Submit.
- The mode is remembered per device. A new, empty song always opens in
  Lyrics mode, because there is nothing to put chords on yet.

Everything downstream reads the text through one adapter, `getText()` /
`setText()`.

## Risks still open

- **Real-device behaviour**: autocorrect, predictive text and dictation next
  to hidden chords, in Lyrics mode on iOS Safari and Android Chrome.
- **Trackpad strip feel**: how many pixels of drag per seam. Tune it on a
  phone.
- **Book-identical rendering**: an e2e test compares `.cl-segment`
  geometry against `#work/old-home-place`. Extend it to a dozen works.

## Order of work

1. ✅ First build: CodeMirror, book-identical view, ChordPro mode, chord
   menu (A/B/C), glyphs, section bar, text adapter, old preview removed.
2. **Rework to three modes** (this revision): add the mode switch and
   Chords mode with the sheet, the strip, Move and Remove. Remove the
   keyboard-state machine, ♪/Aa, the magnifier and the margin drag. Fix the
   triage findings from the first phone test.
3. Phone test, tune the strip, settle the key-changer question.
4. **Drafts for the lead-sheet editor** (E2).

## Decisions

Decided (2026-10-26):

- Three explicit modes, `Lyrics | Chords | ChordPro` (replaces "the keyboard
  is the mode").
- Desktop uses the same modes; typed chord entry works in Chords mode (the
  double-click-to-Chords shortcut was removed 2026-10-27).
- Lyrics and Chords modes look exactly like the book (CodeMirror 6,
  vendored).
- ChordPro mode's preview is read-only.
- The chord menu: key triads / flipped quality (♭VII in the vii° column) /
  progressive decorations. Replaces layouts A/B/C.
- Spelled-out glyphs (maj⁷, not Δ⁷).
- Design goes through Claude Design.
- 2026-10-27: `⋯` opens a second row (6/9 11 13 ° ø7 + [m(maj7)] / bass) under a
  fixed 8-cell main row, the owner's choice over swapping the row or scrolling
  it. The picker grows only while it is open. minor/dim/aug + sus = plain sus
  (`Dm` + sus2 = `Dsus2`); tapping sus off restores what it replaced.

Open:

1. **The key in the chord sheet**: transpose, declare, or not there at all.
2. **Chord menu**: the vii° column's second-row cell (♭VII, or the strict flip).

## For Claude Design

These are *proposed* states in `design/ui-states/`, next to D1–D7. Each needs
a phone and a desktop version, light and dark:

- `e3-chord-menu`: drawn (the mockup)
- `e3-lyrics-empty`: new song, empty chart, Paste
- `e3-lyrics-song`: writing, book-identical, chords inert
- `e3-section-bar`: lines selected, the section bar floating
- `e3-chords-mode`: the docked sheet with the trackpad strip, the box on a
  syllable
- `e3-chord-selected`: a chord selected, Remove / Move
- `e3-chordpro`: side by side (desktop); Source/Preview (phone)
- `e3-mode-switch`: `Lyrics | Chords | ChordPro` in the top band
