# Session Handoff — TEF↔OTF Fidelity Loop

## RESUME PROMPT (paste into a new session)

```
Let's continue the OTF work — editor phase.

Connect these folders:
- /Users/mike/workspace/bluegrassbook.com/feature-otf-editor  (worktree, branch feature/otf-editor)
- /Users/mike/workspace/bluegrassbook.com  (container — git via
  GIT_DIR=<mount>/.bare/worktrees/feature-otf-editor,
  GIT_WORK_TREE=<mount>/feature-otf-editor, nbstripout override
  -c filter.nbstripout.clean=cat -c filter.nbstripout.required=false;
  commit via add + write-tree/commit-tree/update-ref — full status/
  commit exceeds the sandbox's 45s call cap)

Read SESSION-HANDOFF.md first. Rendering/playback is done and
oracle-backed (jobs #1 done); we're on job #2: make the editor
user-friendly. The goal is something BETTER than TablEdit, free and
in-browser — NOT a TEF viewer.

IMPORTANT: the editor must serve guitar, bass, banjo, AND mandolin
equally. Don't over-optimize for banjo — no banjo-only assumptions in
the facade or UI (string counts, tunings, roll presets are DATA, not
architecture). What matters generically: fast note input (click/tap
and keyboard), fast copy/paste of phrases (select a beat/measure/
phrase, paste at cursor, transpose on paste later), duration handling,
and undo that never lies.

Start with the editing facade: a clean API over OTF documents
(insert/delete/move notes, selection, copy/paste of tick ranges,
ts-aware measure math via docs/js/renderers/measure-timing.js, undo/
redo) that BOTH mouse/touch UI and the vim-style keyboard drive. Then
wire it into work-view behind an Edit button (edit real site tabs, not
just editor-demo.html). Test each instrument with real parsed OTFs:
27493 has guitar+bass+mandolin+banjo tracks (docs/data/tabs/ has
copies; untracked dev harness docs/tab-dev.html?id=<pid>).

Tests first, vitest for everything (npx vitest run — 522 pass; npm
install @rollup/rollup-linux-arm64-gnu --no-save first in the sandbox).
The editor's 314 existing unit tests must stay green while the facade
is extracted. Rewrite e2e/otf-editor.spec.js as the UX stabilizes (it
predates the modal redesign — see handoff). Serve locally with
python3 -m http.server 8081 --directory docs (main worktree owns 8080;
hard-refresh Chrome, it caches ES modules). Commit each landed piece;
I'll push.
```

**Goal:** Finish the browser tab editor. Mike doesn't care which engine
renders — just that tabs **render + edit in-browser + play back** across
banjo, mandolin, guitar, bass. The TEF→OTF parsing-fidelity loop that
consumed the last sessions is **done**; the remaining work is below.

**MIKE'S POLICY (binding):** parsing is deterministic. A parsed OTF is
**verified** only when it matches the TablEdit oracle export of that exact
file at 100%. Heuristics are triage, never a stopping point.

---

## Current state (2026-07-02, all pushed to origin)

- **Oracle batch: 87 VERIFIED / 20 PARTIAL / 0 DIVERGED** over the 107
  source-backed files. PARTIAL = the ONE module TablEdit's MusicXML export
  contains matches 100%; the file's other modules are simply unverified
  (MusicXML exports only one module of a multi-track file).
- Parser tests: 43 passed, 1 skipped (`python3 -m pytest tests/parser/`).
- Everything the MusicXML oracle can see is handled, V2 and V3: positions
  (native-grid exact), frets, ties, triplets (eighth/quarter/16th spans),
  anacrusis/pickup measures, mid-tune time-signature changes, strummed
  chords, accompaniment-pattern notes, fingering-annotation bytes.
- `parsed/` regenerated for all 107 source-backed files. The other ~223
  parsed files remain at the git baseline (no verified source located).

### Harness (all in `spike/`)
- `oracle_verify.py --batch spike/oracle_manifest.json` — re-verifies all
  107 files against the MusicXML exports in `spike/oracle/batch/` (no GUI
  needed; exports exist). Rewrites verdicts in place. Single-part exports
  are best-match paired to an OTF track (PARTIAL at best).
- `regen_parsed.py` — regenerates `parsed/` from
  `spike/oracle_batch_queue.json` (pid → host TEF path; maps host paths to
  sandbox mounts; preserves `x_source` so git diffs stay musical).
- `oracle_compare.mjs` — 3-way diff (parser / editor-replay / oracle) for
  single files. `roundtrip_gate.mjs` — editor insertNote replay gate.

### Environment gotchas
- Sandbox git: `GIT_DIR=<container-mount>/.bare/worktrees/feature-otf-editor`,
  `GIT_WORK_TREE=<container-mount>/feature-otf-editor`, plus
  `-c filter.nbstripout.clean=cat -c filter.nbstripout.required=false`
  (the filter command is a host-absolute path). Set author/committer env
  vars (sandbox has no git identity). If `index.lock` complains, enable
  file deletion for the container folder, then `rm` it.
- `pip install pytest --break-system-packages`; parser is pure stdlib
  (`python3`, no uv needed) from `sources/banjo-hangout/src/`.
- vitest on the Linux sandbox: `npm install @rollup/rollup-linux-arm64-gnu --no-save`.
- nbstripout BrokenPipeError in Mike's shell after git commands: harmless
  (git closes the filter pipe early); upgrade nbstripout to silence.

---

## Follow-up jobs, in order

### 1. ~~Frontend consumption of `metadata.time_signature_changes`~~ DONE (2026-07-03)
Landed as `docs/js/renderers/measure-timing.js` — the shared ts-aware
measure-math module (per-measure tick lengths, timelines with cumulative
start ticks, locate(), reading-list expansion, repeat-sign analysis,
metronome schedule). Renderer, player, work-view, tab-ascii, and editor
state all consume it. **Design it as the seam for job #5's editing
facade** — it's UI-free on purpose.

Also fixed en route (each its own commit):
- otf.py only emitted ts changes for V2; V3 (27493 m30/49) dropped them.
- Denominator bug: ticksPerMeasure was numerator*480 everywhere — every
  2/2 measure was halved (notes rendered past the barline).
- Reading-list expansion skipped silent measures WITHOUT advancing the
  counter — sparse tracks played early (27493 mandolin: 5 measures).
- tab-ascii hard-coded 60 ticks/char (one 2/4 measure).

Tie flags / finger annotations / suffixed ids audit: clean.

Rendering polish from Mike's visual review vs TablEdit (all in
tablature.js + measure-timing.js, each unit-tested):
- Engraved time-signature glyphs (Bravura/SMuFL via jsdelivr, serif
  fallback) at m1 + every effective change incl. reversion; pickups
  unmarked (notated under the global signature, TablEdit-style).
- Adornment footprint rule (`_adornmentsFor`): repeat signs and
  signatures GROW the measure; the note area never shrinks. Register
  future edge decorations there.
- Notes centered per measure (noteOffset splits the last note's
  trailing duration-space); barlines span the staff only.
- **Two-feel toggle**: MeasureTiming feel:'two' presents 4/4→2/2 and
  2/4→1/2 (tick-neutral); signature glyphs, beam grouping (per
  beatTicksFor), metronome, and cursor snapping all follow. Native 2/2
  files get half-note beaming/snapping too.
- `_beamRuns` duration filter: quarters are never beamed into eighth
  ligatures (m6 of 22456 caught this in two feel).
- Metronome toggles live (master gain node); playback cursor +
  highlights fan out to all visible tracks.

Verified: 522 vitest unit tests; live in Chrome on 22456 (3/4 pickup),
18926 (1/4 pickup + repeats), 27493 (mid-tune 2/4, 169.6s total vs ~87s
under the old math). Untracked dev harness: `docs/tab-dev.html?id=<pid>`
+ OTFs in `docs/data/tabs/` (22456, 18926, 27493, 11449, 23602, 24091;
no published work references banjo-hangout tabs yet —
docs/data/index.jsonl has no tablature_parts). Serving tip: main
worktree tends to own :8080; run this worktree side-by-side with
`python3 -m http.server 8081 --directory docs` (scripts/server kills
other python servers on 8080-8090). Chrome caches ES modules — hard
refresh after edits.

**Known stale: `e2e/otf-editor.spec.js` behavioral tests.** The spec
predates the modal redesign (keyboard.js: NORMAL handles nav+entry, no
INSERT mode), so mode/entry tests fail honestly; selector-level fixes
landed so hooks no longer time out. Rewrite the spec with job #2. The
old "Playwright e2e pass" claim below was wrong. Sandbox note: abcjs/
supabase/WebAudioFont CDNs are blocked in the Cowork sandbox — abc,
list-management, favorites e2e and audio playback only work on the Mac.

Player nuance (pre-existing, revisit with job #2): note durations are
truncated at the next event on ANY track (rhythmicGap), which also cuts
tied melody notes short when backing tracks are playing.

### 2. Editor UX — the goal (reprioritized 2026-07-04; facade + wiring LANDED 2026-07-05)

**Landed 2026-07-05 (5 commits, suite 602 green, roundtrip gate 301/301):**
- `docs/js/otf-editor/facade.js` — **EditingFacade**, the UI-free API (2a
  done). Explicit positions, ts-aware everything via measure-timing
  (tie-splitting across short measures, tick-range copy/cut/paste with
  re-bucketing, toAbs/locate), transact() + snapshot undo w/ rollback,
  string counts from tuning data. Tie continuations emit `tie: true`
  (what tablature.js/tab-player.js consume) — NOT the old tech:'~'.
- `state.js` — EditorState is now UI-session state delegating every doc
  mutation to the facade (otf/clipboard are pass-through getters;
  state.history is a canUndo/canRedo/clear view). 314 tests unchanged.
- `docs/js/otf-editor/work-edit.js` — edit-session controller +
  `resolveEditTrackId` (part instrument → lead role → first). work-view
  got an ✏️ Edit button (inside the ⚙️ Controls disclosure!) on every
  tablature part (2b done): Done applies to the view in memory +
  re-renders, Ctrl+S applies without exit, Cancel confirms when dirty,
  Download exports. OTFEditor/EditorState accept `trackId` so
  multi-track OTFs open on the viewed part. NB: edits are in-memory
  only — persistence/submit-as-correction is still open.
- editor.js `_render` now passes `state.facade.timing` to TabRenderer:
  the editor renders ts-changes correctly (narrow 2/4 measures, glyphs).
- Click mapping rewritten: `positionFromSvgPoint` (cursor.js, pure,
  unit-tested) hit-tests TabRenderer rowData geometry per row/measure —
  ts-true and scroll-proof. Old uniform mapper is fallback only.
- `facade-27493.test.js` — all four instruments of the real 27493
  exercised at the 2/4 seams; undo-to-pristine deep-equality.
- Live-verified in Chrome (tab-dev harness, per-track Edit buttons —
  harness is untracked): guitar/bass/mandolin/banjo mount, click
  placement lands M:30 inside the short measure, fret entry, undo,
  Done-applies. Beware: signature-glyph text rects bleed ~beyond their
  row (h≈144px), and `focus()` scrolls the page — screenshots go stale.

**Known gaps / next in line:**
- ~~Cursor OVERLAY (crosshair + grid) uniform-math drift~~ FIXED
  (1cefc1f6c): svgPointForPosition + gridLinesForRow draw from rowData
  geometry, den-aware beat emphasis; uniform layoutInfo is fallback
  only (kept for editor-demo + jsdom tests where rects are zero).
  ~~Keyboard nav uniform-math~~ FIXED (41ee9d085): moveByTicks /
  moveToMeasureEnd go through facade.toAbs/locate/ticksFor — the
  phantom back-half of short measures is gone (it was storing
  out-of-range notes that drew past the barline: Mike's m30/31
  report). Same commit: duration IS the working increment (arrows/
  Space/auto-advance step by currentDuration; grid ruler follows
  duration, explicit grid buttons override until next duration
  change); toolbar clicks refocus the editor root.
  state.ticksPerMeasure now only feeds selection normalization + the
  no-facade fallbacks.
- **Grid model unified (a840f037b), per Mike's spec:** gridSubdivision
  is THE working increment (ruler lines + arrow/hl movement + click
  snap, one definition); currentDuration only sets entered-note length
  + auto-advance + rests. Duration re-syncs grid clamped ≤ 1/4.
  Auto-expand RATCHETS (never shrinks mid-session). Duration buttons
  are text (1, 1/2, 1/4…) — the SMuFL glyphs were blank boxes, which
  read as "whole/half/quarter don't exist". Toolbar Rest button =
  advance one duration (same as Space).
- **Stale-ruler fix + rest glyphs (76abece60):** TabRenderer re-renders
  itself ASYNC (debounced resize observer, Bravura arrival) — new
  onAfterRender hook refreshes cursor/grid overlays after EVERY layout
  pass (Mike's "doubled rulers" = stale grid over the new layout).
  Rest glyphs: SMuFL rests (Bravura path, like the signature digits) in
  gaps after duration-carrying events, greedy whole→32nd;
  duration-less parsed tabs render unchanged.
  restSpansForMeasure/restGlyphSequence exported + tested.
- **Duration→grid coupling minimized (cbd240cf1):** refine-only, by
  divisibility — grid changes ONLY when it can't express the selected
  duration's positions (the one hard invariant: click/arrow placement
  quantizes to grid). Coarser durations never touch the grid; explicit
  grid buttons absolute. Known residual edge cases: (1) grid stays
  fine after a fine passage — arrows get slow; use w/b beat-nav or an
  explicit grid click. (2) A user CAN explicitly set a grid coarser
  than their duration — their call. (3) Mixed triplet/straight in one
  measure needs grid flips per phrase (grids don't nest).
- **Tie arcs across barlines (cdca18327):** renderSlurs moved to ROW
  scope + per-kind distance caps (techniques 60px, ties a full
  measure) — split whole notes now show their arc to the [bracketed]
  continuation.
- **Cross-row half-arc + chord entry (e74ac8f32):** row-leading tie
  continuations get an incoming half-arc; Shift+digit (event.code
  match) inserts on the current tick WITHOUT advancing — pinches/
  chords via j/k + Shift+digit (ergonomics item #3 done).
- **Periodic ruler (beffb94af):** the LAST ruler artifact wasn't
  staleness — per-measure note CENTERING (noteOffset varies with each
  measure's last event) made grid lines from neighboring measures land
  px apart at barlines. Renderer option centerNotes (default true,
  reading view unchanged); editor sets false → stable tick→x, gap
  kinds {slot, barline} only. If editing ever feels "left-packed",
  that's this tradeoff — intentional.
- ~~2d~~ DONE: e2e/otf-editor.spec.js REWRITTEN against the shipped
  design (c100365c8) — 14 tests, all passing in the sandbox
  (headless-shell + libXdamage stub recipe; no audio assertions).
  Found+fixed: context-menu actions left keyboard focus dead.
  NB: CI's gate is npm test (vitest) only — e2e is the local layer.
  Tied-note truncation FIXED (3f1b4586e): explicit durs + tie chains
  play full length (cut only by same-string re-attack); ring-model
  parsed tabs sound unchanged.
  **GO-LIVE STATUS: machinery complete incl. SAVE-BACK — now PR-BASED
  (d5fa9c13f, replacing the issue-body flow; OTFs blew the 64KB issue
  cap).** Editor 🚀 Submit / create.html → create-tab-pr edge function
  (supabase/functions/create-tab-pr/index.ts): branches off main,
  commits the OTF via contents API, opens a labeled PR
  (tab-correction/tab-submission) → process-tab-pr.yml finalizes the
  branch (process_tab.py provenance + index rebuild --skip-fuzzy) →
  merging the PR = approval. Remaining before merge: (1) Mike deploys
  `supabase functions deploy create-tab-pr` (GITHUB_PAT needs contents
  write), (2) ear checks (playback durations, repeats UI, create.html),
  (3) nav link for create.html, (4) merge to main (CI = vitest 711 ✓;
  also 14 e2e + ~71 pytest locally).

### USABILITY QUEST round 1 (2026-07-08, from Mike's live pass)
Mike: "interact with the served website… play buttons missing, some
tabs parse weirdly (cherokee-shuffle-a), focus-mode exit dead." All
fixed + live-verified on :8081 (commits 2e67513b9, d2912d3c4):
- **33 golden works had STALE PARSES** from the denominator-bug era
  (2/2 measures left-packed at half width — cherokee-shuffle-a's "weird
  parse"). Re-converted every golden work with a local downloads/*.tef
  source (33 changed / 11 identical / 32 no local source), rebuilt
  docs/data/tabs + index.jsonl (--skip-fuzzy; FULL fuzzy now exceeds
  the sandbox 45s cap). Lesson: after any parser fix, regen works/ too
  — parsed/ regen alone leaves published works stale.
- **Focus-mode exit/prev/next dead on work pages**: work-view renders
  #focus-exit-btn etc. but nothing wired them (song-view wires its own
  copies). Global click delegation in main.js now catches all four
  (incl. #focus-controls-toggle).
- **Play button hidden behind the collapsed ⚙️ Controls disclosure**:
  tablature parts now default the disclosure EXPANDED (stored pref
  still wins) — work-view.js.
- **Header ✏️ Edit (next to Export) opened the ChordPro song editor on
  tab-only works** — empty paste box, dead end. Hidden on tablature
  parts via partUsesSongActions() (utils.js, tested); song-view
  renderSong restores it. The tab controls row keeps its own ✏️ Edit.
- Verified end-to-end in Chrome: search (landing box is Enter-driven)
  → version picker (attribution shown) → work; focus enter/exit; tab
  Edit session mount/cancel; create.html serves. NB: probing the DOM
  right after navigation races the async OTF render (~2-3s) — the
  song-view stays .hidden until first render; wait before asserting.
  Browser HTTP cache can serve stale OTF JSON on the dev server —
  hard reload before judging parses.
- Export dropdown on tab-only works still offers ChordPro/Plain-text
  copy+download (empty/meaningless there; Print may be useful). Left
  as-is — decide with the create.html nav-link at merge time.

### FIDELITY round 2 (2026-07-10, from Mike's TablEdit side-by-side)
Mike loaded source TEFs in TablEdit next to the site and caught three
parser blind spots, all oracle-INVISIBLE to the old (measure, tick,
string, fret) comparison (commits 2b108d2d8, 2ae86fd3d, 31ab7e9dd):
- **Same-length ts RE-LABELS**: 21874 has a 2/2 header but an explicit
  4/4 type-27 marker on every measure (d3=0, same 1920 ticks) — the
  reader dropped d3=0 markers as no-ops. Now emitted; a uniform
  all-measure re-label promotes to the global signature.
- **V3 meter was a hardcoded guess**: otf.py said '2/2 # Cut time for
  bluegrass' for every V3 file. The V3 measure table is authoritative
  (27493 is 4/4 w/ 2/4 at m30/49; 25635 is 4/4). v3_global_ts = the
  table's dominant explicit signature.
- **NOTE DURATIONS were never parsed**: both branches misread the
  duration byte as a 'marker char' (V2 byte3 / V3 byte5; 0x49 'I' =
  eighth + dynamics). decode_duration_code(): base = 1920>>(code//3);
  %3: 1 = dotted of next-shorter (base*3/4 — base*3/2 was 2x long on
  every dotted note), 2 = triplet (base*2/3). Bits 0-4 of the byte;
  V3 bit7 stays the tie flag. Derived by FITTING bytes to oracle
  <duration>s (byte5 = 1.000 consistency), validated corpus-wide.
- **oracle_verify.py now compares durations** (5-tuples). 41
  downloads-backed files: 32 VERIFIED + 9 PARTIAL, 0 DIVERGED. The 66
  raw_tabs-sourced parsed/ files are STALE (no dur, maybe wrong ts)
  until that mount returns — regen + re-verify then.
- Regenerated: parsed/ (41), all 44 golden works w/ local sources +
  mirrors + 27493 dev fixture. Positions byte-stable, durs added.
  Explicit durs = the tab-player's written-length playback path and
  real rest glyphs; gap-inference now only covers the 30 no-source
  works.
- Cross-format twin fixture: Mike's Desktop 21874 was a V3 re-save of
  our V2 file → tests/parser/fixtures/cherokee_shuffle_21874_v3.tef +
  twin test (notes/tuning/reading list/meter must agree V2 vs V3).
- Tuning verified independently: oracle pitch−fret per string == our
  track tuning (21874: E4 C#4 A3 E3 A4). The XML leg still can't see
  tuning per se (it compares string/fret) — a tuning check in
  oracle_verify would close that hole corpus-wide (small, worthwhile).
- ~~Tempo~~ FIXED (d89e74fe9): V2 = header field, V3 = u16 @ 0x06
  (verified 40/40 vs oracle export tempos; 25635 = 260 — the 100
  hardcode played it at ~38% speed). TablEdit GUI Rich-MIDI export of
  25635 also verified PITCHES exact on all 3 tracks (banjo/guitar/
  bass; guitar deltas = TablEdit's 5-20 tick strum stagger).
- **V3 ARTICULATIONS restored (e1bf50fb1)**: they died silently in a
  refactor — the V2 effect1 gate always trips on V3 (byte 4 = fret
  byte) and the old fallback misread byte 5 (= the DURATION byte; a
  half note decoded as a slide). Real V3 techs: byte 6 on the SOURCE
  note (1 h / 2 p / 3 sl) → attributed to next note on the string
  (compute_articulations_v3). 25635 = the export's 22 marks exactly.
- **KNOWN GAP — V2 techniques**: the effect1 plausibility gate nukes
  ALL techs in 12 V2 files that really have them (corpus tech report:
  27 perfect / 14 off; 11245, 15313, 12124, 18779 over-reports 4…).
  Needs the oracle-fit treatment per file, then ADD TECHNIQUES to the
  oracle_verify tuple so this dimension can't rot invisibly again.
  Method that worked twice now: align TEF records to oracle XML notes,
  fit each byte for consistency.
- Three Cherokee Shuffles now: cherokee-shuffle = 25635
  (stratovarious520), cherokee-shuffle-a = 21874 (ShhhItsASecret),
  cherokee-shuffle-banjo-break = schlange. Mike's 'notes don't agree'
  was TablEdit-21874 vs site-25635 — different arrangements.
- 2c UX passes — see the ERGONOMICS WALKTHROUGH below (2026-07-05),
  which replaces the old loose list.

**Entry/removal fixes landed 2026-07-05 (d6125e28a) from Mike's
hands-on pass:** digits insert instantly (two-digit refine in place:
1,2 quickly → 12, replay-safe); Delete + Backspace(Mac delete) remove
the note UNDER the cursor (Backspace steps back on an empty slot);
measureWidthFloor auto-expands measures at 9px per grid slot for
1/16–1/32 grids; overlays refresh synchronously after render (the
rAF-only path left stale grids, esp. in throttled background tabs).

### ERGONOMICS WALKTHROUGH (2026-07-05): entering an AABB tune from scratch

Thought experiment: enter a standard 2-part fiddle tune (AABB, 8-bar
parts, repeats w/ 1st-2nd endings, banjo lead rolls + guitar
boom-chuck + bass roots-fifths), as a real user. Friction found, in
priority order (impact × cost):

1. ~~**Play-from-cursor / loop-a-selection**~~ DONE (426b982a7).
   TabPlayer.play({startTick, endTick, loop}) — clip AFTER duration
   calc, rebase to t=0, exact-length ranges so loops repeat in time;
   loop restart cancellable by stop(). Editor: Shift+Space/Ctrl+Space
   toggles play-from-cursor; L loops the VISUAL selection (+1 grid
   step), falls back to play-from-cursor. NOT yet ear-verified (Mike:
   needs a real user gesture for audio — synthetic events can't resume
   the AudioContext; also rAF pauses viz/loop-restart in hidden tabs).
2. ~~**Mouse drag-select + copy/paste**~~ DONE (32365ef61). Drag →
   VISUAL tick-range selection with geometry-true highlight spans
   (selectionRectsForRow); toolbar ⧉✂📋🔁 buttons; Cmd+C/X/V; Delete
   clears selection in VISUAL. Fixed en route: keyboard's
   _deleteSelection bypassed undo history (raw mutation) — now
   state.deleteSelection() via facade.deleteRange. Mike's direction
   2026-07-05: mouse interaction is the priority track now.
   ALSO DONE (44f934cfc): drag-MOVE — grab inside the selection
   highlight, dashed drop preview, one-undo facade.moveRange
   (clipboard-preserving), selection follows the phrase; right-click
   context menu (context-menu.js, injected actions) with Copy/Cut/
   Paste/Delete/Loop-or-Play enablement. Still open mouse-side:
   paste-transpose, note-drag (move a single note by its head),
   double-click fret pad polish.
3. **Chord entry without advancing** — a pinch (two notes, same tick)
   costs ArrowLeft + j/k + digit today because entry auto-advances.
   Shift+digit = insert on current tick WITHOUT advance (then j/k,
   Shift+digit, then one advance). Tiny change, constant use.
4. **Roll/pattern presets** — rolls are 8-note templates over a chord
   shape (data per instrument, NOT architecture): forward, backward,
   forward-reverse, alternating-thumb; guitar boom-chuck; bass
   root-five. Insert template at cursor, then retouch frets. This is
   the "pattern-based" DESIGN.md promise and the biggest raw-keystroke
   win (a roll = 1 action instead of ~24 keys).
5. ~~**Repeat signs + endings editing**~~ DONE (15384a6c0): facade
   repeatSpan / repeatSpanWithEndings / removeRepeat over reading_list
   (expand→splice→recompress); editor renders compact marks; playback
   maps written↔unrolled both directions; context-menu Repeat ×2 /
   Remove repeat on measure selections. LIVE CHECK PENDING (dev server
   wedged mid-verification; jsdom mount of 27493 clean).
6. ~~**In-editor track switcher**~~ DONE (e89bc8534): state.setTrack +
   toolbar Track dropdown for multi-track docs.
7. ~~**New-tab-from-scratch flow**~~ DONE (e89bc8534):
   docs/create.html + create-tab.js (buildNewTab, localStorage drafts
   with Resume/Discard); actions.createMultiTrackOTF. Not yet linked
   from the site nav — decide placement at merge time.
8. **Paste-transpose** (shift frets/strings on paste, harmony parts) —
   original brief's "transpose on paste later"; after #2.

Keystroke reality check for context: one 8-measure banjo roll part =
~64 notes × (string move + digit) ≈ 180-200 keys today; with #4 it's
~8 pattern inserts + fret retouches ≈ 40-60. #3 halves chord cost.


### 2-old. Original framing (kept for context)
**Mike's framing: the goal is not showing TEF, it's building something
BETTER than TablEdit — a free in-browser tab app.** Editor
user-friendliness comes before verification breadth (old jobs 2-4,
now 5-7). `docs/js/otf-editor/` has solid internals (314 unit tests,
modal keyboard model, undo, recorder, insertNote roundtrip gate) but is
wired only into editor-demo.html and the UX is not shippable. The
DESIGN.md vision is right: "as fluid as typing text", pattern-based
(rolls/licks as first-class), casual users on mouse/touch AND vim-style
power users, mobile-friendly. Suggested order:

**Multi-instrument constraint (Mike, 2026-07-04): guitar, bass, banjo,
mandolin are all first-class. Don't over-optimize for banjo —
instrument specifics (string counts, tunings, roll/pattern presets)
are data, not architecture. The generic wins are: fast note input,
fast copy/paste of phrases, clean duration handling.**

a. **Editing facade**: a clean API over OTF documents (insert/delete/
   move notes, selection + copy/paste of tick ranges, ts-aware measure
   math via measure-timing.js, undo/redo) that the UI calls — decouple
   editor internals from keyboard.js so mouse/touch UI and keyboard
   drive the same ops, on any string count.
b. **Wire into work-view**: Edit button on any tab work → edit in
   place, preview with playback, save/export OTF (and a submit-as-
   correction path later). Editing the site's real tabs is the payoff.
c. **UX passes vs DESIGN.md**: note entry by click/tap + fret pad
   popover, duration/articulation toolbar, roll/pattern insertion,
   ghost-note preview, loop-a-selection playback practice mode.
   Two-feel & signature glyph support come free via measure-timing.
d. **Rewrite e2e/otf-editor.spec.js** against the real modal design as
   the UX stabilizes; fix the tied-note truncation player nuance.

"Better than TEF" yardsticks: no install, instant playback with cursor,
pattern entry faster than TablEdit, works on an iPad at a jam, shareable
by URL, free.

### 3. ~~Publish the verified tabs~~ DONE for VERIFIED (9a341df1a)
32 new works created from the 87 VERIFIED (55 already covered by the
golden-44 + intra-batch duplicate tunes; one banjo part per work —
variants are a future nicety). index.jsonl: 44 → 76 works with
tablature_parts, full attribution. New: src/import_verified.py driver
(keyed to oracle_manifest verdicts, seeds 34 scraped catalog entries);
works_importer provenance carries source_id (attribution links) and no
longer mislabels the tabber as composer; title-match cached. PARTIALs
(20) publish when the Rich-MIDI leg verifies their other modules.

### 3-old. Original notes
Only 44 works have tablature_parts (golden-standard); the 107 oracle-
VERIFIED banjo-hangout OTFs (and later the PARTIAL/remaining ones as
verification widens) should be wired into docs/data/index.jsonl as
tablature_parts with attribution (work-view already renders source/
author credit + disclaimer). This is pipeline plumbing, not new tech,
and it's what makes the site a lyrics+tabs one-stop shop.

### 4. TEF submission flow ("make adding stuff easy")
Same GitHub-issue pattern as process-song-submission: contributor
uploads a .tef → workflow parses (tef_parser), runs sanity checks,
opens a PR with the OTF + work wiring. The parser is done; this is the
cheapest possible "add a tab" path for the Banjo Hangout crowd.

### 5. Rich-MIDI oracle leg — LANDED (2a4160457), 19 PARTIALs need exports
Built and proven on the existing samples: spike/midi_reader.py (stdlib
SMF), spike/midi_verify.py (per-track (tick,pitch) multiset compare;
OTF unrolls reading_list ts-aware, skips ties; ticks ×480/division),
spike/midi_upgrade.py (records evidence in the manifest, promotes
PARTIAL→VERIFIED at 100%). 27493 verified on ALL FOUR tracks →
manifest now 88 VERIFIED / 19 PARTIAL. Discovery: TablEdit SWING
playback — 27493's banjo plays off-beat eighths +40 ticks uniformly;
detect_swing() models exactly that shape (uniform Δ, off-beats only).
NB per-string channels DON'T survive >16-string multi-track files —
string-level tech recovery must use pitch+tuning heuristics; (tick,
pitch) verification is exact regardless. Remaining: export the 19
PARTIALs' .mid via TablEdit GUI (recipe below), then midi_upgrade
each; techniques/chokes recovery from bends + note shapes is the
follow-on (m45 slides).

### 5-old. Original notes
MusicXML exports only ONE module per file; Rich Tablature MIDI contains
ALL tracks (per-string channels) and pitch-bends (chokes).
- Build a MIDI leg for the verifier: parse Rich MIDI, unroll the reading
  list (MIDI unrolls repeats — map back to written measures), compare all
  tracks. Existing samples: `spike/oracle/23398.mid`, `27493.mid`,
  `Welcome to New York - Bill Emerson.mid` (choke-rich: 64 bend events).
- Export the ~20 missing `.mid` files via TablEdit GUI automation
  (computer-use on Mike's Mac — ask first). Recipe that works: open file →
  File→Export→Export MIDI… (Rich Tablature Midi ON) → in the save sheet
  cmd+shift+G → type target dir → Return → Save. ~0.5 s waits between menu
  clicks; export dialog needs ~3 s; the save sheet shares folder state
  with Open, so re-navigate every time; if a tag dropdown opens, Escape
  first. No batch export exists on Mac TablEdit.

### 6. Verify the remaining ~223 parsed files
They're at the git baseline with no verified source. Path: re-download by
id from the hangoutstorage URLs in `tab_catalog.json` (raw_tabs filename
matching proved unreliable — different revisions), then extend
`oracle_batch_queue.json` + export MusicXML per file (same GUI recipe,
~10-15 s/file scripted) and run the batch.

### 7. Known parser gaps (oracle-invisible in MusicXML)
- **Grace notes**: TablEdit MusicXML omits them (verified); V3 has a
  grace flag (component_type & 0x40, currently parsed but unused); V2
  encoding unknown. Rich MIDI may reveal them as short notes.
- **Chokes/bends**: recoverable from Rich MIDI pitchwheel per-string
  channels (see Welcome to New York sample).
- Techniques (h/p/slides) verify against the oracle on files checked so
  far, but the batch verifier compares positions only — extend it to
  techniques once the MIDI leg lands.

### (Optional) TEF 3.0 official spec
A proprietary spec exists (since 2020) — available on request from the
TablEdit author (Matthieu Leschemelle), not redistributable. Would
cross-check the V3 findings below and fill in unmapped component types.
Mike may request it.

---

## TEF format knowledge (oracle-verified, keep)

### V2 (sequential header, 6-byte components at 258)
- Header: 200-201 measures, 202 ts-num, 204 ts-den, 220-221 tempo,
  222 reading-list count, 240 total strings, 241 tracks−1,
  **244-245 u16 == 1 ⇒ anacrusis** (other values ≠ flags, meaning
  unknown), 256-257 component count.
- Location decode: `ts_size = 256*num//den` units/measure (native grid =
  256 units per whole note; 1 unit = 7.5 MIDI ticks @480/q);
  `pos = loc % ts_size`, `string = (loc/ts_size) % nstrings`,
  `measure = loc/(ts_size*nstrings)`, with 256-overflow handling.
  **event.position carries native units end-to-end** (measure*ts_size+pos).
- Component byte2: bits 0-4 fret+1 (1..25 = note; 27 = ts change;
  28/29/30 = non-note), **bit 5 = "effect2 is an annotation"** (LH
  fingering digit, text 0x06, chord 0x07) — NEVER a fret extension.
  Bit 7 on byte2 = accompaniment-pattern note (real note; exempts the
  e2==0x07 chord-overlay skip).
- **byte3 = duration code (bits 0-4) + dynamic (bits 5-7)**. It is NOT a
  marker char. Dynamics 0-5 real, **7 = tie sentinel**. Duration code:
  value = whole >> (code//3); code%3: 1 = dotted, **2 = triplet** —
  triplet notes sit on the straight grid; correct tick = scale the offset
  within the triplet SPAN (= 2×base duration) by 4/3.
- Type-27 ts change: den = 2^(byte2>>5)/2 (0 ⇒ header den); new grid len
  = ts_size − 4·byte3; notes of that measure stored RIGHT-ALIGNED
  (subtract ts_move = 4·byte3). Applies to its own measure only.
- Anacrusis: same right-aligned storage in a full grid slot, but flagged
  in the header (244)==1; shift = first-note offset; emit a measure-1
  time_signature_change.
- effect1 (byte4): legato/slide flags {1,2,3,4} — but in some files the
  byte holds arbitrary 1..15 and is NOT a flag field; plausibility gate:
  any melody note with effect1 > 4 ⇒ distrust for the whole file.
  effect1 0x0e appears on real strummed chords (do NOT skip).
- 50-byte track records near EOF (backward scan validated by cumulative
  string indices + header 240/241): +0 u16 nstrings, +2 u16 firstString,
  +8 u8 GM program, +12 u8 capo, +20 tuning[12] (pitch = 96 − byte;
  SOUNDING incl. capo — never add capo), +32 name[16]. Packed variant
  (1 record = 2 sub-tracks) exists. Oldest sub-variant: 240/241 zeroed,
  no records ⇒ name-pattern fallback.

### V3 (binary container, magic `debt`/`tbed` at 0x38, 12-byte components)
- Header pointer table (u32 file offsets): **0x5c → measure table**
  `[u16 ?][u16 count]` + 8-byte records, record k = measure k (record 0
  stub; missing/zero = header default), **byte0 = den, byte1 = num**.
  0x60 → track table `[u16 68][u16 count]` + 68-byte records (V2 layout
  superset; name[36] at +32; program/capo u16). 0x3c → components.
- Note component: bytes 0-3 location (`VALUE_PER_POSITION = 32 *
  total_strings`; string = (loc%VPP)/8), byte4 type: bits 0-4 fret+1,
  bit 6 grace flag (unused so far — NEVER read byte4 as an effects
  byte); byte5 marker char, **bit 7 of byte5 = tie**.
- **Positions are CONTINUOUS 16th slots**: a 2/4 measure in a 4/4 tune
  occupies 8 slots and everything after shifts — map absolute slots
  through the measure table's cumulative boundaries.
- V3 non-/4 HEADER signatures still assume 16 slots/measure in otf.py
  (`ticks_per_measure//16`) — fine for the current corpus (all V3
  divergers were 4/4) but revisit if a 6/8 V3 file appears.

### Oracle semantics
- MusicXML: divisions per part (240 ⇒ ×2 scale to 480 tpq); tech
  attribution on the `type="stop"` note; grace notes and one module only
  per file; no chokes/bends. Rich MIDI: all modules, per-string channels,
  pitchwheel = chokes, repeats unrolled.
- 2,035 raw_tabs files: 89% V2, 31 V3 (5 of them a `00 00 xx 03`
  no-magic variant that still fails), 196 HTML junk.

## Corpus / sources policy
- `downloads/<id>.tef` are provably-correct sources. raw_tabs filename
  matching is unreliable (revisions differ) — `spike/verified_sources.json`
  holds the triaged map; re-download by catalog URL for anything else.
- Works are ephemeral: never hand-fix a work; fix the parser and rebuild.
