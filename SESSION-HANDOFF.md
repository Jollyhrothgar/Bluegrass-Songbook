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

### 2. Editor UX — the goal (reprioritized 2026-07-04)
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

### 3. Publish the verified tabs (one-stop-shop payoff, cheap)
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

### 5. Rich-MIDI oracle leg (verify the 20 PARTIALs' other modules)
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
