# Plan: Tab editor input — closing the gap with TablEdit (and friends)

*Drafted 2026-08-20 on `feature/tab-editor-improvements`. Survey + gap analysis;
no code changes yet.*

## Framing

The OTF editor (`docs/js/otf-editor/`) is a browser re-implementation of the
subset of TablEdit that matters for bluegrass tab: a string × time grid, a
cursor, type-a-digit-to-place-a-fret, durations, slur articulations, copy/paste,
playback. This plan is about **input** only — how fast and how predictably a
person can get a tune from their head (or a TablEdit screen) into the editor.
Rendering, submission, and the personal bucket are covered elsewhere
(`tab-authoring.md`, `contribution-pipeline.md`).

**Baseline: TablEdit.** The first outside feedback (§7) came from a
long-time TablEdit user whose position is that TablEdit is already nearly
perfect — and every one of the 19,000 tabs in `works/` was authored in it.
So this plan treats TablEdit's behaviour as the default to match, and each
place we deviate (column-rule auto-duration, vim letters, anything the
browser forbids) has to say why. The vim-style layer from the early OTF
editor days survives as a *preset*, not as the default.

Sources:

- TablEdit hotkeys: <https://tabledit.com/help/english/hotkeys.shtml>
- TablEdit entry/duration/effects tutorials: `noteentryedit.shtml`,
  `noteduration.shtml`, `special_effects.shtml`, `basictabentry.shtml`
  (all under <https://tabledit.com/help/english/>)
- Cross-platform survey (Guitar Pro 8, MuseScore 4, TuxGuitar, Soundslice,
  Flat.io, Power Tab, text/vim-style input) — §4 below
- Our own bindings: `keyboard.js` (the truth), `editor.js:_showHelp` (what we
  *tell* people), `DESIGN.md` §Keyboard Shortcuts (what we once planned)

## 1. What we actually have today

Read from `keyboard.js`, not from the design doc. Three modes: NORMAL (nav +
entry — the planned INSERT mode was folded in), VISUAL, ANNOTATION.

| Area | Bound today |
|---|---|
| Fret entry | `0–9` places a fret at the cursor and auto-advances by the current duration. `1`/`2` open a 300 ms refine window so `1`,`2` → fret 12 in place. `f` + two digits for 10–24. `Shift+digit` places **without advancing** (chord stacking). |
| Durations | `q` ¼ · `e` ⅛ · `s` 1/16 · `t` 1/32 · `W` whole · `H` half. Triplet only via toolbar button (`Shift+#` sets a triplet *grid*). |
| Articulation before entry | `Ctrl+h` / `Ctrl+p` / `Ctrl+/` / `Ctrl+t` arm a pending tech (h, p, /, ~) that lands on the next note entered. |
| Articulation after entry | `A` → ANNOTATION mode: `h` `p` `/` `~` set tech on note at cursor, `x` clears, `t` `i` `m` set right-hand fingering; `h`/`l` step note-to-note. |
| Navigation | `h`/`l`/arrows by **grid**; `j`/`k` strings; `w`/`b` by beat; `Space` by duration (a "rest"); `Enter` next measure; `$` measure end; `gg`/`G` doc start/end. |
| Editing | `x` delete note · `dd` delete tick · `D` delete to measure end · `Backspace` typewriter delete · `o`/`O` insert measure after/before · `.` repeat last insert/delete. |
| Clipboard | `y`/`yy` copy · `p`/`P` paste · `v` visual + `hjkl` extend, `y`/`d` · `Cmd/Ctrl+C/X/V`. Mouse drag-move of a selection with preview. Context menu: repeat measures ×2 / remove repeat. |
| Text | `c` add/edit placed text (section label, chord) · `C` delete. |
| Undo / play | `u`, `Ctrl+R`, `Cmd+Z`, `Cmd+Shift+Z` · `Shift/Cmd+Space` play from cursor · `L` loop selection. Note audition on entry (`_playNoteFeedback`). |
| Help | `?` overlay. |

Facade ops that exist but have **no keyboard or UI binding** (free wins):
`setNoteDuration`, `moveNote` (string-to-string), `moveToMeasureStart`,
`moveToNextEvent`/`moveToPrevEvent` outside ANNOTATION mode, `repeatSpanWithEndings`.

Facade ops that **don't exist**: delete measure, ripple insert/delete within a
measure, transpose note ±1 fret, apply duration to a selection, paste-merge.

### Things that are wrong right now (flag before building on them)

1. **Tie is dead data.** `Ctrl+T`, the popover `~` button and ANNOTATION `~`
   write `tech: '~'`. Nothing reads it: `renderers/tablature.js` and
   `tab-player.js` only know `h p / \ x b`, and a real tie is `tie: true` on
   the *continuation* note (1,785 of them in a 400-file sample; the facade
   itself writes `tie: true` when a long note crosses a barline). A user who
   "ties" two notes gets no arc and no sustain, and the submission carries a
   tech value the corpus has never contained. → triage as ROOT FIX: `~`
   should set `tie: true` on the note at cursor (and the renderer's existing
   tie-arc code will draw it).
2. **`Ctrl+T` can't be pressed on Chrome for Windows/Linux** — `Ctrl+T`,
   `Ctrl+W`, `Ctrl+N` are browser-reserved and never reach the page. Mac users
   (Cmd is reserved, Ctrl is free) are the only ones the binding works for.
   `Ctrl+H` (history) and `Ctrl+P` (print) *are* interceptable, but every
   articulation key being a Ctrl chord is the single biggest ergonomic gap vs
   TablEdit's one-letter `H P S`.
3. **The `?` overlay and toolbar tooltips disagree with `keyboard.js`:**
   overlay says `w`/`b` = "next/prev measure" (they move by *beat*); overlay
   and the toolbar tooltip say `3` = triplet (`3` is fret 3 — there is no
   triplet key); the grid-toggle tooltip says `G` (it's `\`; `G` is go-to-end).
4. **VISUAL `<`/`>` (shift selection) is a stub** (`_shiftSelection` is an
   empty TODO). DESIGN's `dw`, `yw`, `{n}G`, `0` measure-start are also
   unbuilt; `0` can't be measure-start because it is fret 0.
5. **VISUAL `h`/`l` extend by current *duration*, NORMAL `h`/`l` move by
   *grid*.** Same keys, two step sizes.
6. **The corpus has techs the editor cannot produce:** dead note `x` (706 in
   sample — every mandolin chop) and choke/bend `b` (83; issue #184). The
   renderer and player already handle both.

## 2. TablEdit's input model, and where ours differs

TablEdit (TE) and our editor share the same skeleton — grid cursor, current
duration, digit = fret, optional auto-advance — so a TE user's muscle memory
mostly transfers. The differences that matter:

| Concept | TablEdit | Ours | Gap? |
|---|---|---|---|
| Auto-advance | **Toggle** (`Ctrl+Space`); off by default, `Tab` advances by duration explicitly | Always on; `Shift+digit` as the no-advance escape hatch | Yes — chord entry. TE users expect "type 0, ↓, type 2, ↓, type 0" to stack a chord. Add the toggle; keep `Shift+digit`. |
| Two-digit frets | `1` then digit; or `Shift+A..J` = 10–19 in one keystroke | 300 ms refine window; `f`+2 digits | Minor. Our refine window is better than TE's (no mode), but `Shift+A..J` is a nice one-stroke path for banjo up the neck (12, 15, 17). `Shift+letter` is mostly free for us. |
| Rest | `.` places an explicit rest object of the current duration | `Space` skips; OTF has **no rest events** (silence is implied by `dur`) | Format-level. Not an input gap for playback; only for rendering stems in notation view, which we don't have. Skip. |
| Duration set | `F4–F9` | `q e s t W H` | Chrome lets a page intercept `F4 F5 F7 F8 F9` (yes, even F5 — `preventDefault` on keydown stops the reload) but not `F6` (address bar) or `F11` (fullscreen). So the TablEdit preset can keep F4/F5/F7/F8/F9 and needs an alias for quarter (F6); `q e s t W H` stay as aliases in both presets. Mac keyboards need `Fn` — TablEdit-on-Mac users already live with that. |
| **Duration change on existing notes** | select → `F-key`, `*` apply, `<`/`>` halve/double | **none** — delete and re-type | **Big.** `setNoteDuration` exists unbound. |
| Dotted / tuplets | `Ctrl+.` dotted, `:` double-dot, `Ctrl+3/5/7/9` tuplets | triplet grid only (toolbar); no dotted | Dotted is real for 3/4 and 6/8 waltzes; quintuplets are not bluegrass. Add dotted + triplet key. |
| Auto-duration | `Ctrl+Alt+F4`: duration inferred from gap to next note | none | TE's beginner mode. Cheap to add as a *post-hoc* "fix durations from spacing" (`J` in TE). Medium. |
| Staccato | `/` halves playback duration | none | Skip for now. |
| **Articulations** | one letter, applied after the fact to the selected note: `H P S B C G M R N(clear) L(tie)`; `F3` repeat last effect | `Ctrl+letter` before entry, or `A`-mode letter after | **Big** (see §3). |
| Which note carries the slur | TE: the *first* note ("hammer to the next note on the same string") | OTF: the *target* note | Not a gap — ours matches how tab reads (`2h4`: the 4 is hammered). Document it in the help. |
| Move note across strings, same pitch | `Ctrl+±` | none (`moveNote` exists unbound) | Nice for guitar/mandolin re-fingering; rare for banjo. Low. |
| Transpose note ±semitone | `+`/`-` | none | Cheap typo fixer (`+` = fret+1). Low-medium. |
| Ripple insert / delete | `Alt+Insert` / `Alt+Delete` shift everything right of cursor by one duration | `dd` empties a tick but leaves the hole; `o`/`O` insert whole measures | Medium — "I left out a note" is the most common correction in transcription. |
| Delete measure | `Delete` on an empty measure | **none** | Gap — you can insert measures but never remove one. |
| Measure start/end | `Ctrl+←/→` | `$` only | Bind `^` (vim) or `Ctrl+←/→`. Trivial. |
| First/last string | `Ctrl+↑/↓` | none | Trivial. |
| Note-to-note | `,` / `;` | only inside ANNOTATION mode | Bind in NORMAL. Trivial. |
| Go to measure | `Shift+F5` dialog | none (`{n}G` designed) | Trivial once a count prefix exists. |
| Selection | `Shift+arrows` extend; `Ctrl+A`; `Ctrl+E` select-by-type | `v` + `hjkl` only | **Shift+arrows is the non-vim expectation.** Add alongside `v`. |
| Paste blend | `Shift` during paste merges with existing notes | paste overwrites | Low. |
| Repeat last | `F3` re-applies last effect / repeats last insertion | `.` repeats last insert/delete only | Extend `.` to techs and to "repeat last measure". |
| Playback | `Space` play/stop, `F10` measure, `F11` selection, `±` speed | `Shift+Space` from cursor, `L` loop | Add "play this measure" and tempo nudge. Low. |
| MIDI step entry | yes | no | Web MIDI exists in Chromium; future. |
| Fingering | `Alt+0..4` left hand | `A`-mode `t i m` right hand only | OTF has `lh` (7 in sample). Low. |

## 3. Recommendations

Ordered by (value to a transcriber) ÷ (effort). Each is a single PR-sized
slice; none depends on another except where noted.

### P0 — correctness (do first, small)

- **Fix tie**: `~` → `tie: true` on the note at cursor; popover/toolbar/A-mode
  all route through one facade op (`setTie(pos, bool)`). Strip any `tech: '~'`
  on load. Test against the renderer's tie-arc path.
- **Make the `?` overlay generated from the binding table** so it can't drift
  again (see "binding table" below). Fix `w`/`b`, `3`, `G` claims now.
- **Unify step size**: VISUAL `h`/`l` should step by grid like NORMAL.
- **Square cursor** (one grid slot × one string) and **stems 2.5px** in the
  editor — two small changes the first user asked for by name (§7).

### P1 — the input gaps TablEdit users will hit in the first minute

0. **Automatic duration** (§6) — `currentDuration = null` = auto; column
   rule; recompute in the facade; session pins; `=` to toggle; `J` to fix
   durations after the fact. Retires triplet mode and the phantom `3` key.
1. **Auto-advance toggle** (`Ctrl+Space` or a toolbar latch, shown in the
   status bar). With it off, digits place and stay; `Space`/`Tab` advance.
   Keep `Shift+digit`.
2. **Change duration of existing notes**: in NORMAL with a note under the
   cursor and no selection, `q e s t W H` set *that* note's `dur` as well as
   the current duration (TablEdit's `*` semantics, folded in); in VISUAL,
   apply to the selection. Add `<`/`>` = halve/double (NORMAL: note at cursor;
   VISUAL: selection — this *replaces* the stub shift-selection binding, which
   nobody has; move shift to `Shift+<`/`>` or drop it).
3. **Articulations as single letters, after the fact — TablEdit's letters.**
   In the TablEdit preset (the default): `H` hammer, `P` pull-off, `S` slide,
   `M` muted/dead (`x`), `C` choke (`b`), `L` tie (toggle, as in TablEdit),
   `N` clear, `F3` repeat last effect — applied to the note at cursor, or to
   the selection. These are all free once nav is on arrows. One semantic
   difference to document in the help: TablEdit marks the *first* note of a
   hammer pair, OTF marks the *target*; `H` on either note of the pair
   should do the right thing (if the note at cursor has a same-string
   successor and no predecessor-slur, mark the successor).
   - In the **vim preset**, where `h p s` are taken, the same actions sit
     behind an `a` operator prefix (`ah ap a/ a~ ax ab an`).
   - Keep `Ctrl+h/p//` pending-before as a power path in both presets
     (interceptable); **drop `Ctrl+T`** everywhere. Retire ANNOTATION mode's
     tech keys; keep it for fingering (or `Alt+0..4` as TablEdit).
   - Adds dead note and choke entry, closing #184's input half.
4. **Dotted duration** (`.` is taken by repeat; use `'`?) and a **triplet key**
   that the help can honestly advertise (`Shift+3` is the grid; `3` is a fret —
   candidates: `T` is 32nd grid… `z`? Decide together with the binding table).
5. **Delete measure** (`dm`? vim-ish; or `Delete` on an empty measure like TE)
   and **ripple insert/delete** (`Alt+Delete` / `Alt+Insert` as in TE; or vim
   `X`/`I`) within a measure.
6. **Shift+arrows extend selection** from NORMAL; `Ctrl/Cmd+A` select measure,
   twice for all. **`Ctrl+←/→`** previous/next measure (universal; `Enter`
   stays as "next measure" too).
7. **Re-string a note, preserving pitch: `Alt+↑/↓`** (`facade.moveNote`
   already exists; the pitch→fret math needs the track tuning, which the
   player already has). The most consistent cross-product expectation after
   arrows-and-digits.

### P2 — speed

- **Repeat last measure** (`R`, or `.` on an empty measure): the single most
  valuable accelerator for bluegrass backup and vamps. Copy previous measure
  into this one and land the cursor at its start.
- **Count prefixes** (`3w`, `12G`, `4.`): DESIGN promised `{n}G`; a tiny count
  buffer in `keyboard.js` gets all of them.
- **"Type a lick" prompt** (`:` or `i`): one line of VexTab-style text —
  `0h2 3/5 (0.1 2.5)` with the current duration carried forward — parsed
  and placed at the cursor as one undoable facade transaction. No new
  keybindings to collide; the same parser is a free ASCII-tab import later.
- **Note-to-note `,`/`;`**, **`^` measure start**, **`K`/`J` first/last
  string** (TablEdit's `Ctrl+↑/↓` is Mission Control on macOS).
- **Roll mode** (`r`): DESIGN §Roll Mode — `T I M` letters pick strings
  5/3/2, digits modify fret, `P` pinch. TablEdit has nothing like it; it is
  *our* banjo-specific edge. Build after the `a` operator settles, since both
  want letters.
- **Transpose `+`/`-`** on the note at cursor.

### P3 — later / format-level

- `Shift+A..J` = frets 10–19 (TablEdit-only convention; the refine window
  already covers it).
- Keybinding presets (TablEdit / Guitar Pro) as data files over the binding
  table — only if a second preset is ever actually asked for.
- Auto-duration / "fix durations from spacing" (TE `J`).
- Left-hand fingering (`lh`), harmonics, vibrato — OTF has `lh`; the rest need
  format + renderer + player work first.
- Paste-blend, MIDI step entry, play-current-measure, tempo nudge.
- Explicit rests — only if a notation view ever exists.

### The binding table (prerequisite for everything above)

`keyboard.js` is 880 lines of `if (key === …)` and the help overlay is a
hand-written copy that already lies in three places. Before adding ~20
bindings, lift the bindings into one declarative table —
`{ mode, keys, action, label, group }` — that drives (a) dispatch, (b) the
`?` overlay, (c) toolbar tooltips, and (d) a test that every advertised key
is bound and every bound key is advertised. That is the one refactor this
plan asks for, and it is what makes **two presets** a pair of data files:

- **`tabledit` (default)** — arrows for nav; `Tab` advance by duration;
  `Ctrl+Space` auto-advance toggle; `F4 F5 F7 F8 F9` + `q e s t W H`
  durations; `Ctrl+.` dotted; `Ctrl+3` triplet; `<`/`>` shorter/longer;
  `*` apply duration to selection; `H P S M C L N` effects, `F3` repeat
  effect; `+`/`-` fret ±1; `Ctrl+±` re-string same pitch; `Ctrl+←/→`
  measure edges; `,`/`;` prev/next note; `Shift+F5` go to measure;
  `Shift+arrows` select, `Ctrl+A` all; `Insert` measure before, `Delete`
  on an empty measure removes it; `Alt+Insert`/`Alt+Delete` ripple;
  `Shift+A..J` frets 10–19; `Space` play/stop, `F10` measure, `F11`
  selection. Everything here is a TablEdit key, so the user in §7 can sit
  down and type. Exceptions forced by the browser/OS, to list in the help:
  `F6` (quarter → `q`), `Ctrl+↑/↓` on macOS (Mission Control → `Alt+↑/↓`),
  `Ctrl+Alt+F4` auto-duration (→ `=`).
- **`vim`** — today's `hjkl w b gg G x dd D o O y p u .` plus the `a`
  operator for effects. Mike's layer; opt-in.

The action vocabulary is shared; only the key column differs. A third
preset (Guitar Pro) is then a lunch-break job if anyone asks.

Conflicts to settle when laying out the table (decide, don't drift):

- `.` is TablEdit's rest and vim's repeat. We have no rest object; in the
  `tabledit` preset `.` = advance by duration (what a rest *does* for us),
  in `vim` it stays repeat.
- `3`/triplet, `G`/grid, `w b`/measure — stop advertising what isn't bound.
- Browser-reserved chords on Chromium: `Ctrl+T Ctrl+W Ctrl+N F6 F11` (all
  platforms), every `Cmd+…` on macOS; `Ctrl+↑/↓` is Mission Control on
  macOS. Never bind them.

## 4. Cross-platform survey

Researched from official docs (Guitar Pro 8 support + shortcut lists,
MuseScore 4 handbook, TuxGuitar help, Soundslice help/blog, Flat.io help +
migration guide, LilyPond/ABC/alphaTex/VexTab references, Denemo manual).
Power Tab's docs are mostly unreachable; treat its row as partial.

### Per-product, input-relevant facts only

| Product | Mode | Fret entry | Two-digit frets | Duration | Auto-advance | Effects |
|---|---|---|---|---|---|---|
| **Guitar Pro 8** (the lingua franca) | modeless | digit on selected string | **timeout** — "a delay is allowed… press 1 then 0 for fret 10" | `+`/`-` on the *current beat* (post-hoc); `Shift+.` dot | select-beat-then-type; advance is moot | single letters toggled on the note: `H` hammer/pull, `S` slide, `B` bend, `V` vibrato, `L` tie, `P` palm mute, `I` let ring, `G` grace, `Y` harmonic, `!` staccato, `N` trill |
| **MuseScore 4** | explicit note-input mode (`N`) | digit on the string the cursor sits on | sequential (`1` then `0`) | digit keys set duration **before** the note (`1`…`9`); `0` rest; `.` dot; `Ctrl+3` triplet; `T` tie | yes (typewriter) | `S` slur; `Ctrl+↑/↓` re-string preserving pitch; `Alt+Shift+↑/↓` fret ±1; `R` repeat last note/chord; `Ctrl+Alt+1–4` voices |
| **TuxGuitar** | modeless | digit 0–29 | not specified | `+`/`-` | n/a | `H P B S V G F`, **`X` dead note**; `Shift+←/→` fret ±1; `Shift+↑/↓` re-string keeping *fret*; explicit **insert-rest-beat / move-beat-left** ripple primitives; paste-in-place vs paste-in-new-measure |
| **Soundslice** (browser) | modeless | digit 0–36 | not documented | `+`/`-` | **no** — arrow yourself | `Alt+↑/↓` re-string preserving pitch; ships **shortcut presets** (default / Finale / Guitar Pro / Sibelius) |
| **Flat.io** (browser) | modeless, pitch-letter first; tab digits supported | digit on string | **timeout** ("quickly type the two digits") | `1–7` longest→shortest (the *reverse* of MuseScore — Flat's own migration guide warns about it); `,` tie; `.` dot; `T` triplet | yes | `S` slur (their docs warn "not staccato like MuseScore"); `Ctrl+G` go to measure; `Shift+arrows` select; `V` voices |
| **Power Tab** (legacy) | modeless, mouse-heavy | click + type | ? | bottom bar or `Shift+arrows` | ? | menu-driven, fully rebindable |
| **Denemo** (the real "vim-like") | **four modes**, `Esc` → default | pitch letters `a–g`; same letters *edit in place* when the cursor is on a note | n/a | `Y U Space I O P` = whole…32nd; `Alt+0–6` rests | append vs edit by cursor state | `hjkl` navigation; `a–g` also *jump to* the next note of that pitch |
| **LilyPond / ABC / alphaTex / VexTab** (text) | n/a | alphaTex `fret.string`, VexTab `fret/string`; LilyPond is pitch-first with `\4` to force a string | n/a | **duration carries forward** until changed (all four); VexTab `:q` runs | n/a | VexTab glues single letters onto frets — `6h8p6`, `10b12`, `X` muted, `^3^` tuplet — the closest thing to "type the tab as you'd read it" |

### What the survey changes in the recommendations

1. **Our skeleton is on-convention.** Fret-first digits, a persisting
   current duration (the text formats' "carry forward"), and a timeout for
   two-digit frets are exactly the GP8/Flat/TablEdit model. Nobody surveyed
   uses a prefix key for high frets — `f12` is our invention and `Shift+A..J`
   is TablEdit-only. Keep the refine window as the primary path; `Shift+A..J`
   drops to P3.
2. **Re-stringing a note while preserving pitch is the most consistent
   expectation across products** (GP8, MuseScore, Soundslice; TuxGuitar keeps
   the fret instead). It is unbound for us though `facade.moveNote` exists.
   Promote to P1. Key: **`Alt+↑/↓`** (Soundslice's) — not `Ctrl+↑/↓`, which
   macOS owns for Mission Control, and not TablEdit's first/last-string
   meaning. Mandolin/guitar tabbers will reach for this constantly; banjo
   less so.
3. **Post-hoc duration change is universal** — GP8/TuxGuitar/Soundslice
   `+`/`-`, TablEdit `<`/`>`, MuseScore/Flat re-press the digit. We have none.
   P1-2 stands; pick `<`/`>` (TablEdit, and it leaves `+`/`-` for fret ±1,
   which TuxGuitar/MuseScore also offer under other keys).
4. **`Shift+arrows` to select and `Ctrl+←/→` for measures are universal**
   (GP8, MuseScore, TuxGuitar, Flat, TablEdit). Both trivial; P1.
5. **Effect letters have no standard** — `H` for hammer/pull is the only
   cross-product agreement; `S` means slide *or* slur, `T` means triplet *or*
   tie, `L` is GP8's tie. The market's answer is rebindable keys and presets
   (Soundslice, Power Tab, Flat's migration guide). That is the strongest
   argument for the declarative binding table: a "Guitar Pro" or "TablEdit"
   preset becomes a data file, not a rewrite. Don't build presets now; build
   the table so they're possible.
6. **Auto-advance is a genuine fork** (MuseScore yes, Soundslice no, TablEdit
   toggle, GP8 moot). A toggle is the only answer that serves both the
   typewriter transcriber and the chord-stacker. P1-1 stands.
7. **Only TuxGuitar names its ripple primitives** (insert rest beat, move
   beat left, paste in new measure). Every other editor leaves
   insert-vs-overwrite implicit and users learn it by accident. Naming ours
   in the help ("`dd` empties, `X` closes the gap") is cheap and rare.
8. **Denemo's trick — the same letter appends when the cursor is on empty
   space and edits in place when it's on a note — is what our digits already
   do** (`insertNote` on an occupied slot replaces). Worth stating in the help
   as a feature; it is the vim-ness people actually feel.
9. **VexTab's inline grammar (`6h8p6`, `10b12`) is the best model for a
   "type a lick" fast path** — an optional text prompt that accepts one
   measure of VexTab-ish notation and places it at the cursor would be a
   cheap, high-leverage power feature, and it sidesteps every keybinding
   collision. P2 candidate; pairs naturally with roll mode.
10. **Voices, rests-as-objects, and grace notes** are first-class everywhere
    else and absent from OTF. Voices stay a non-goal (banjo tab doesn't need
    them); grace notes and rests are format questions, not input ones — P3.

## 6. Automatic duration — design

### What TablEdit does (`note_menu.shtml#automaticduration`)

> "By default, if no explicit current duration is selected, TablEdit
> automatically assigns notes entered a logical duration in relation to the
> beginning and end of the measure as well as to the preceding and following
> notes."

- **Auto is the absence of a chosen duration**, not a separate mode. Pick an
  F-key and you're explicit; clear it and you're auto. (There *is* a hotkey,
  `Ctrl+Alt+F4`, but it's unmemorable and may not exist on the Mac build —
  hence the feedback "it should be a hotkey".)
- **Rule: gap to the next note on the same string**, bounded by the measure.
  First note in an empty measure shows as a whole note; put another note an
  eighth later on the same string and the first becomes an eighth.
- **Last note fills to the measure end**; "Automatic rests" is a separate
  *display* option that draws the implied rests.
- **Retroactive and symmetric**: inserting shortens the neighbour, deleting
  re-extends it. **Manually set durations are pinned** — auto never touches
  them.
- The palette "dynamically displays the automatic duration of the note that
  would be inserted" — the prediction is visible before you type.

### How it maps onto our model

Our editor has two independent knobs that TablEdit fuses: `currentDuration`
(what `dur` a typed note gets, and how far the cursor auto-advances) and
`gridSubdivision` (arrow step, click snap, ruler). Auto-duration collapses
them: **position becomes the only rhythm input, so the grid is the rhythm
input.** That is the "interaction with the grid" — and it is mostly good
news:

| Today | Under auto-duration |
|---|---|
| choose duration → type fret → cursor jumps by duration | move by grid → type fret → `dur` = gap to next onset; cursor steps **one grid slot** |
| triplet *mode* (half-built) + triplet grid | triplet grid alone: a 160-tick gap *is* a triplet eighth; no mode needed |
| no dotted durations at all | a 360-tick gap *is* a dotted eighth; free |
| `Space` = advance by duration ("rest") | `Space` = advance by grid; the previous note simply sustains through |
| grid must be ≥ as fine as what you navigate | grid must be ≥ as fine as the **shortest note you'll write** (TablEdit's "pick the 1/32 view for 16th triplets" advice) — the status bar should say so when auto is on |

Design decisions, with the reasoning:

1. **`currentDuration = null` means auto** — TablEdit's semantics exactly.
   `q e s t W H` leave auto; one key (proposal: `=`, or an **Auto** button
   at the head of the duration group) returns to it. The status bar shows
   `Dur: auto (♪)` with the *predicted* duration for the cursor slot, and the
   ghost note draws that stem.
2. **Column rule, not same-string rule, by default — and the corpus says
   that *is* the TablEdit-faithful choice.** TablEdit's documented
   same-string gap would make every 5th-string note of a Scruggs roll
   (`5 3 2 5 3 2 5 3`) a dotted quarter. What TablEdit users actually
   produce, measured on 95,702 notes across every 5-string banjo track in
   `docs/data/tabs/` (all TablEdit-authored TEFs): eighths 63.6%, sixteenths
   18.7%, quarters 13.8%, **dotted quarters 0.1%**. Rolls are written as
   eighths — i.e. `dur` = gap to the next onset on **any** string of the
   track, within the measure. That rule makes auto-entered tabs identical in
   shape to the imported ones and keeps the player's sustain matching what
   it already does for them. Same-string can be an option later for a
   fingerstyle guitar tabber; TablEdit's separate "ringing notes" is the
   right home for sustain anyway.
3. **Recompute inside the facade transaction.** `insertNote` / `deleteNote`
   / `deleteTick` / `paste` take an `autoDuration` option; the facade
   recomputes `dur` for the affected measure's unpinned notes in the same
   `_mutate`, so one `u` undoes the note *and* the neighbour's stem change.
   Never recompute from the keyboard layer.
4. **Pinning is session state, not format.** OTF has no "manual duration"
   flag and shouldn't grow one. Keep a `Set` of note identities
   (`measure:tick:string`) entered under auto this session; only those are
   recomputed. A reopened document is therefore fully pinned, which is the
   right default — you didn't type those. Explicit duration keys on a note
   (P1-2) pin it.
5. **Trailing silence can't be expressed** — the last note fills to the
   barline because OTF has no rests. That is the one real loss versus
   TablEdit. The escape hatch is P1-2: park on the note, press `q`, it's a
   pinned quarter. Drawing implied rests for *leading* gaps (TablEdit's
   "Automatic rests") is a renderer nicety for later.
6. **A one-shot `J`-style "fix durations here"** (measure, or selection)
   that ignores pins is worth shipping in the same PR: it is the same
   function, and it repairs hand-entered tabs where someone forgot to
   change duration.
7. **Non-binary `dur` values already render**: the same corpus count has
   751 triplet eighths (160), 135 dotted eighths (360) and 122 dotted
   quarters (720) on banjo tracks alone, all drawn by today's renderer. No
   renderer work is needed for auto-duration's output.

Why it belongs at the top of P1 rather than P2: the feedback says it
directly ("duration + rhythm is more important than fret", "automatic
duration is good"), and it retires two half-built things (triplet mode, the
`3` key) instead of adding a third.

## 7. Early user feedback → actions

One TablEdit user, first session. Quoted, then what it means for the plan.

| Feedback | Reading | Action | Where |
|---|---|---|---|
| "you need the tabledit midi sound… I was thinking about recording my banjo and making it the banjo sound" | Our banjo is FluidR3 GM via WebAudioFont (`tab-player.js:40`); TablEdit plays the OS GM synth, which is what they're used to. | Make the instrument voice a **swappable sample set**, and build one from *their* banjo: per string, open + fret 5 + fret 10 (15 short samples, trimmed, normalised), pitch-shifted ≤5 frets by `playbackRate`. WebAudioFont already takes a zone table, so it's data, not a new player. Also try GeneralUserGS banjo as a zero-effort A/B. | playback — separate PR; not input |
| "the cross hairs… should be a square like in tabledit" | `cursor.js:_updateCursorStyle` draws whiskers (and still branches on a dead `'insert'` mode). | Square cell outline the size of one grid slot × one string, colour by mode. | P0, trivial |
| "first stanza and the second stanza's bar lines are not lined up to compensate for the 4/4 … not the notes, but the bar lines, and then yes the notes" | `tablature.js:645` gives a short (pickup, 2/4) measure **proportional** width, so row 1's barlines land off row 2's. TablEdit does the same, which is why they call it TablEdit's mistake too. | **Equal slot width for every measure regardless of tick length**; a pickup sits in a full slot with its notes right-aligned to the barline. Notes already sit proportionally within the slot (`tick/ticks × noteW`), so once barlines align, beats align. | renderer; editor default |
| "horizontal shifting / column mutation makes it non-deterministic where measures run" | The editor's `measureWidthFloor` ratchet (`editor.js:1075`) plus `measuresPerRow: 'auto'`: change the grid and measures jump rows. | In the editor, **fix measures per row** (default 4, user-settable) and zoom/scroll horizontally instead of reflowing. Deterministic rows are also what makes "go to measure 12" a place you can *see*. | editor layout; pairs with the row above |
| "click on a string and drag a note to different string and get the same tone" | Pitch-preserving re-string, by mouse. | P1-7 (`Alt+↑/↓`) plus: dragging a single note vertically re-frets it to keep the pitch; horizontal drag moves it in time (the existing selection drag-move). | P1 |
| "thicker stems desires" | `stemWidth: 1.5`. | Editor default 2.5; consider site-wide. | P0, one number |
| "making new measures" | The cursor clamps at the last barline (`cursor.js:moveByTicks`, `maxTick − 1`); `o` is undiscoverable. | **Walking past the end appends a measure** (`→`, `Space`, `Enter` on the last measure), GP8-style; `Delete`/`dm` on an empty trailing measure removes it. | P1-5 (with delete measure) |
| "Duration + rhythm is more important than fret for accessible notes" | Rhythm entry today is *harder* than fret entry (no post-hoc duration change, no auto). | Auto-duration (§6) and duration-on-existing-notes (P1-2) become the P1 headline. | P1 |
| "Automatic duration is good (… not a hot key, but it should be)" | Confirms §6; give it a key. | `=` / Auto button, shown in the `?` overlay. | P1 |

## 5. What this plan does not do

- No change to the OTF format except removing the never-valid `tech: '~'`.
- No notation (standard-staff) view, no rests as objects.
- No mobile/touch input work — the popover remains the touch path; this plan
  is keyboard-first.
