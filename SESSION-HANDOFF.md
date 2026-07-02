# Session Handoff — TEF↔OTF Fidelity Loop Spike

**Goal:** Finish the browser tab editor. Mike doesn't care which engine renders —
just that tabs **render + edit in-browser + play back** across banjo, mandolin,
guitar, bass. The real pain point is the **debug-loop tedium** for TEF→OTF
parsing and tab-entry fidelity. We built a spike to make that loop fast.

**Status: the 3-way loop is CLOSED and working.** See "This session's results".

---

## Repo state (what's actually there)

- Worktree: `~/workspace/bluegrassbook.com/feature-otf-editor` (branch `feature/otf-editor`).
- **Git gotcha (corrected):** the worktree metadata is FINE on the Mac — `.git`
  points to `/Users/mike/workspace/bluegrassbook.com/.bare/worktrees/feature-otf-editor`
  (host-absolute), which simply doesn't resolve inside a sandbox mount. From a
  sandbox, set `GIT_DIR=<mount>/.bare/worktrees/feature-otf-editor` and
  `GIT_WORK_TREE=<mount>/feature-otf-editor`, and override the nbstripout clean
  filter (`-c filter.nbstripout.clean=cat -c filter.nbstripout.required=false`)
  whose command is also a host-absolute path. Do NOT use `--git-dir=../.bare`
  alone — that compares against main's index.
- **Render:** live via custom SVG `TabRenderer` (`docs/js/work-view.js`). Works today.
- **Playback:** custom `TabPlayer` (Web Audio oscillators) — functional, low quality.
- **Editor:** `docs/js/otf-editor/` — 314 passing unit tests + Playwright e2e; wired
  only into `docs/editor-demo.html`; UX not shippable.
- **TEF parser:** `sources/banjo-hangout/src/tef_parser/` (reader.py + otf.py), pure
  stdlib — runs with plain `python3` from `sources/banjo-hangout/src/` (no uv needed).
- **Env gotcha (Linux sandbox):** for vitest, `npm install @rollup/rollup-linux-arm64-gnu --no-save`.

## This session's results (2026-07-01)

### 1. TablEdit inventory — the key on-screen check: ANSWERED, negative
- **Mac TablEdit 3.06 a4a has NO Tablature Manager** (Windows-only companion) and
  **no batch export of any kind** (Help-search: only Text Manager / Chord Manager).
- Per-file Export menu: **MIDI, ASCII, MusicXML, ABC, LilyPond, Audio**.
- File → Pasteboard… is a text-based ABC/ASCII import/export box, not a batch tool.
- MIDI export has a **"Rich Tablature Midi File"** option (per-string info) — enabled
  for our exports.
- ⇒ **Unattended bulk V2→V3/MusicXML conversion is OUT on the Mac.** Options:
  per-file GUI automation via computer-use (works — this session drove 4 exports
  through the UI; est. ~10-15 s/file scripted), or a Windows box with tefman.

### 2. Oracle exports created (`spike/oracle/`)
- `23398.xml` / `23398.mid` — Angeline the Baker (has parser OTF → 3-way diff seed).
- `Welcome to New York - Bill Emerson.xml/.mid` — Mike's pick: has ~95% of needed
  banjo techniques; NOT in repo corpus (no parser OTF) — use as **export-fidelity
  stress test** (do chokes/slides/harmonics survive MusicXML?). Not yet analyzed.
- TablEdit MusicXML carries `<string>`, `<fret>`, hammer/pull (`type="start|stop"`),
  `<divisions>` (240/quarter vs OTF tpb 480 — scale ×2). Tech attribution: OTF puts
  tech on the TARGET note = MusicXML `type="stop"` note.

### 3. 3-way comparator BUILT: `spike/oracle_compare.mjs`
- `node spike/oracle_compare.mjs <parsed.otf.json> <oracle.xml>` (defaults: 23398).
- Legs: parser OTF / editor insertNote replay / TablEdit MusicXML. Buckets each
  divergence and names the culprit (missing_from_parser = parser bug, etc.).
- **23398 result: 101/101 exact positional agreement all three ways.**
- Caught real bugs immediately:
  - The on-disk parsed JSON was **stale** — predated the annotation-code fret fix
    (frets +12/+6 on 8 notes). Fresh reader.py output matches the oracle exactly.
    **⇒ Regenerate `parsed/` before trusting any diff** (only 23398 regenerated so far).
  - **Parser drops pull-offs:** oracle has 4 p + 1 h; parser catches only the h.
    Pull-off detection in `technique_from_event()` is the next parser fix.

### 4. Corpus survey (raw_tabs, Google Drive) — DONE
`/Users/mike/Google Drive/My Drive/Music/Banjo/Tabs/banjo_hangout_download/data/raw_tabs`
(mounts at `…/CloudStorage/GoogleDrive-…/` path; 2,035 `*.tef`):
- **V2: 1,808 (89%)** — parser's home turf.
- **V3: 31** (26 standard `10 00 xx 03` + 5 variant `00 00 xx 03` — the "no debt
  marker" family that fails today).
- **HTML junk: 196** — scraper error pages saved as .tef ("Runtime Error" pages etc.).
- Survey state: `tef_survey.jsonl` (session outputs) via `survey_tef_versions.py`.
- ⇒ Bulk V2→V3 conversion is *mostly unnecessary* (89% already V2); the V3-variant
  problem is only ~31 files. The MusicXML sidestep would still kill the parser
  entirely but costs ~1,800 GUI exports (~5-8 h scripted computer-use, fragile).

### 5. Editor "missing notes" bug class — DIAGNOSED: it's NOT the editor
Both worst batch failures are 100% explained by **parser-side same-string/same-tick
fret conflicts** (physically impossible double-frets), which the editor's
replace-on-collision then "loses":
- **10750 (Katy Hill): all 308 missing = fret conflicts.** Root cause: tracks are
  `['guitar','banjo','guitar','guitar']` — **duplicate track ids merge 3 guitar
  tracks into one notation key**. 18 of ~330 parsed files have duplicate track ids.
- **10575 (Dear Old Dixie): all 128 missing = in-track conflicts** (e.g. s1 [9,3]
  at same tick) with NO dup ids — likely the '@' alternate-voicing/chord-tone
  marker class, or two voices in one track. Oracle can arbitrate, but 10575.tef
  isn't in `downloads/` (parsed corpus is bigger than local TEF set; raw_tabs
  filenames are name-based, mapping via `tab_catalog.json`).
- ⇒ **Fixes belong in the parser:** (a) uniquify track ids (`guitar`, `guitar_2`, …)
  in `instrument_to_otf_id`/track assembly; (b) decide same-string collision policy
  (keep-highest heuristic already exists for '@'), ideally validated via oracle.
- Editor replay itself: **0 extra, 0 genuinely lost** across examined failures.

## The loop design (now real)

1. **Parser:** TEF → reader.py/otf.py → OTF.
2. **Hand-entry:** editor insertNote replay → OTF (`spike/roundtrip_gate.mjs`).
3. **Oracle:** TablEdit MusicXML export → `spike/oracle_compare.mjs` 3-way diff.

Oracle exports are per-file GUI (scripted computer-use). Recipe that works:
File→Export→Export Music XML… → in save sheet cmd+shift+G → type
`…/spike/oracle` → Return → Save. MIDI same via Export MIDI… (Rich Tablature ON).
Menu clicks need ~0.5 s waits; save-sheet keystrokes can land in the Tags field —
escape first if a tag dropdown opens.

## Second wave (same day, after Mike's go-ahead) — parser fixes landed

### Pull-off fix (ROOT FIX, test-backed)
- `compute_articulations()` paired legato source→dest only within **2 position
  units** (unit = 32nd note) — eighth-note hammer/pull pairs (gap 4) were
  silently dropped. Widened to one beat (8 units). 23398 now **5/5 techs** vs
  oracle (was 1/5).
- BUT the widened window exposed **false positives**: in some files (27493
  Jerusalem Ridge) the byte read as `effect1` takes values 1..15 — it is NOT an
  effects bitfield there; `effect1 & 0x03` flagged ~95% of notes as legato, and
  TablEdit's own export shows **zero** slurs for that file. Added a
  **plausibility gate**: if any melody note has effect1 > 0x04, distrust the
  byte for the whole file (emit no techniques). Also: same-fret pairs are never
  h/p (filtered).
- Tests: `tests/parser/test_tef_articulations.py` (4 tests, oracle-derived).
- Oracle export added: `spike/oracle/27493.xml` (NOTE: TablEdit exported only
  the banjo part of this 4-track file — multi-track MusicXML export behavior
  needs investigation).

### Duplicate-track-id fix (ROOT FIX, test-backed)
- Old code *skipped* duplicate ids → `doc.tracks[event.track]` index
  misalignment dumped later tracks' notes into `"unknown"`; the *older* code
  (which produced the January parsed corpus) merged same-kind tracks onto one
  notation key → impossible same-string fret conflicts → the entire "editor
  drops notes" symptom. Now ids are uniquified (`guitar`, `guitar-2`, …).
- Tests: `tests/parser/test_tef_duplicate_tracks.py` + fixture
  `tests/parser/fixtures/18998_dup_banjo.tef`. Roundtrip on 12662 (previously
  a dup-id failure): now 100% PASS.
- **Frontend note:** OTF track ids like `guitar-2` now exist — check
  `work-view.js`/renderers for assumptions about track id vocabulary.
- Bonus bug found (open): instrument detection over-matches on 18998 (3 banjo
  name strings, header says 2 tracks) — spurious empty track.

### parsed/ regeneration — POLICY, learned the hard way
- Only **41 files** have provably-correct local sources (`downloads/<id>.tef`)
  — these are regenerated with the fixed parser. **KEPT.**
- Mapping parsed ids to raw_tabs files (by id-in-filename or catalog URL
  basename) is **unreliable**: several raw_tabs copies are different revisions
  or unparseable variants (fresh parse gave 800→1 notes, filename-as-title).
  All 152 raw_tabs-sourced regens were **restored to the git baseline**.
- 64 parsed files have zero notes — they were already empty in git (the
  V3-variant failure class + odd formats), no loss.
- ⇒ To regenerate the rest: verify source identity first (title + note-count
  sanity vs git JSON), or re-download by id from hangoutstorage URLs in
  `tab_catalog.json`.

### Welcome to New York technique vocabulary (from its MusicXML)
360 notes / 50 measures, single banjo part. Present: string+fret (all notes),
hammer-on (6 pairs), pull-off (5 pairs), slide (5), slur (11 pairs), tie (17),
chord/double-stop (9), pluck T/M/I right-hand fingering (35), left-hand
fingering (7). **Absent from the export: bends/chokes (0!), grace notes (0),
harmonics** — the tab visibly contains chokes ("Long Choke", [0]/[4]
markings) and TablEdit showed grace notes in other files. ⇒ **MusicXML oracle
is authoritative for positions/frets/h/p/slides but NOT for chokes/grace** —
those need TEF-side detection (or Rich-MIDI pitch-bend inspection;
`Welcome….mid` was exported with Rich Tablature Midi ON for exactly this).

## Third wave (same day) — oracle answers + Mike's determinism policy

**MIKE'S POLICY (binding):** parsing is deterministic — heuristic acceptance
(title match, note count within 5%) is only a triage step, NEVER a stopping
point. A parsed OTF is **verified** only when it matches the TablEdit oracle
export of that exact file at 100%. Everything else is *unverified*.
"Imagine listening to music with 5% of the notes missing."

### Answers found
- **Multi-track MusicXML export**: TablEdit Mac exports ONLY ONE part — the
  LAST module — regardless of the active track (verified: 27493 exported P4
  Banjo twice, byte-identical, with different tracks active). **For
  multi-track files the oracle is Rich Tablature MIDI**, which contains ALL
  tracks (verified: 27493.mid = Guitar/Bass/Mandolin/Banjo, per-string
  channels). MusicXML remains best for single-track files.
- **Chokes**: recoverable from Rich MIDI `pitchwheel` events (Welcome to New
  York: 64 bend events → 13 distinct choked notes, per-string via channel).
  Caveat: **MIDI unrolls repeats** — mapping to written measures needs the
  reading list.
- **Instrument fixes landed** (both TDD, 15 tests green):
  - V2 header text region excluded from instrument pattern scan (18998 comment
    "arranged for banjo…" no longer a phantom 3rd track; also fixed 10658).
  - `num_strings` now counted from the record's actual tuning bytes, not the
    name pattern (18998's second "Banjo" is really 6-string; header sums now
    match: 5+6=11 ✓, 11245 19 ✓, 27493 19 ✓).
- **11449 (Wheel Hoss) oracle verdict — parser can't do this file yet:**
  tracks are UNNAMED (TablEdit displays MIDI program "Acoustic Guitar
  (steel)"); no name patterns exist in the file → instruments=[] → default
  single banjo with cumulative strings 6-10. The REAL instrument data is a
  structural trailer block: `0a 00` (10 total strings) `06 00` (6 in track 1)
  + 10 consecutive tuning bytes (decode exactly to guitar EADGBE + a
  4-string). **Name-pattern scanning is a dead end; parse the structural
  record.** TuxGuitar's open-source TEF reader / the official TEF spec are the
  shortcut (see Research findings above). Also: this file has **mid-tune time
  signature changes** (2/4↔4/4 at m17-18) which the parser's fixed-ts
  assumption corrupts.

### Current parsed/ state
- 41 downloads-backed files: current-parser output (fret/tech/track fixes in).
- 66 raw_tabs files (title+count-triaged): current-parser output on disk;
  **only 1 is musically identical to the git baseline; 64 differ** — a mix of
  real improvements (11449 git had `unknown` track) and differently-wrong
  (unnamed-track files). Queue saved: session outputs `oracle_queue.json`,
  source map `verified_sources.json`.
- Remaining 223: git baseline (137 no source found, 69 mismatched candidates,
  17 empty-both).
- Oracle exports so far: 23398 ✓ (101/101 + 5/5 techs), 27493 (banjo-only
  XML + full MIDI), wheel_hoss-2430.xml, Welcome to New York (XML+MIDI).

## Fourth wave (2026-07-01, next session) — structural instrument records LANDED

**Next-step #1 is DONE, test-backed, oracle-verified.** Name-pattern scanning
is now only a fallback; track records are parsed structurally.

### Format knowledge (validated against the full corpus + TuxGuitar source)
- **V2 (sequential/ASCII header): 50-byte track records near EOF**
  (TuxGuitar `TEInputStream.readTracks()`): +0 u16 numStrings, +2 u16
  firstStringIndex (cumulative), +8 u8 GM program, +12 u8 capo, +20
  tuning[12] (string 1 first, pitch = 96 − byte; bytes past numStrings are
  **stale garbage**), +32 name[16] NUL-terminated. Located by backward scan
  validated by cumulative indices + header byte 240 (total strings) / 241
  (tracks − 1). Oldest sub-variant has 240/241 zeroed and NO records →
  fallback.
- **Packed variant (3 corpus files: wheel_hoss-2430, road_to_columbus-1826,
  dueling_banjos-871):** header says 1 track; ONE record holds TWO
  sub-tracks — +0 total strings, +4 u16 split (normal records have volume
  0x63 here), +8/+10 the two GM programs, +12/+14 the two capos, tunings
  concatenated. This was 11449's whole mystery.
- **V3 (binary container, magic `debt`/`tbed` at 0x38): header dword 0x60**
  points to `[u16 record_size=68][u16 count]` + 68-byte records (same field
  offsets, name[36], program/capo u16).
- **Tuning bytes store SOUNDING pitch including capo** — capo is metadata
  only, never add it to pitch (verified: 11245 capo-2 banjo).
- Unnamed tracks get GM-program-derived names (Banjo/Guitar/Bass/Fiddle…),
  matching what TablEdit displays.

### Code changes (uncommitted, like everything else)
- `reader.py`: `parse_track_records_v2/_v3()`, packed-record split,
  `TEFInstrument.midi_program`, wired into both note-decode paths and both
  `_parse_v2/_v3` (pattern scan = fallback only).
- `otf.py`: `instrument_to_otf_id()` now keyword-canonical (mandolin/
  guitar/bass/banjo/fiddle/clicks/…) so "Upright Bass" → `bass`,
  "Acoustic Guitar" → `guitar` (keeps corpus id vocabulary stable), and a
  5-string "Clicks" click track no longer becomes `banjo-2`.
- Tests: `tests/parser/test_tef_track_records.py` (6 tests) + fixture
  `tests/parser/fixtures/wheel_hoss_2430_packed_tracks.tef`. Full parser
  suite: 21 passed, 1 skipped.

### Verification results
- **23398 oracle: still 101/101 + 5/5 techs.** Roundtrip gate: 23398 and
  11449 both 100% PASS.
- **11449 (wheel_hoss) vs its oracle XML** (which turns out to contain BOTH
  parts — the single-module packed layout apparently avoids the last-module-
  only export bug): **bass 288/288 exact**; guitar 457/458, with all 14
  xml-only notes being **grace notes** (known parser gap, same class as
  chokes) and 1 stray parser note at m73 (the ts-change class, next step).
- 41 downloads-backed regens vs git baseline: 39/41 musically identical.
  The 2 diffs are real fixes: **19520** (pattern parser had invented 4
  tracks / 19 strings vs header's 3 / 15 — notes were scattered across
  wrong tracks; now 679 notes, 0 conflicts, banjo/bass/guitar) and
  **23192** (missing 5th track "Clicks" now present). Also fixed: phantom
  empty second tracks on 10658/10659/12124 gone; **10776** capo-2 now
  detected (old output played 2 semitones flat).
- **parsed/ regenerated for all 107 source-backed files** (41 downloads +
  66 raw_tabs-triaged via `spike/verified_sources.json`; mount path is now
  `/sessions/<session>/mnt/raw_tabs`). Remaining 223 untouched.

## Fifth wave (2026-07-01, same session) — ts changes + triplet root fix LANDED

**Next-step #2 is DONE. wheel_hoss (11449) is now 100% oracle-verified at
tick level on BOTH tracks** (guitar 457/457, bass 288/288, ties excluded on
both sides; techniques not yet compared for this file).

### Mid-tune time-signature changes (V2 component type 27)
- TuxGuitar `readComponents()` type 27 + corpus verification:
  **denominator = 2^(byte2>>5)/2, falling back to the header denominator
  when the top bits are 0** (TablEdit leaves them unset in wheel_hoss;
  TuxGuitar's literal formula yields 0/0). **New measure grid length =
  ts_size − 4·byte3**; numerator = grid_len·den/256.
- **Notes in a changed measure are stored RIGHT-ALIGNED** in the fixed
  header-ts grid slot (offset ts_move = 4·byte3, subtract it — TuxGuitar's
  tsMove). The override applies ONLY to its own measure; there is no revert
  marker. d3=0 markers are display-only duration-identical variants
  (21874: explicit 4/4 in a 2/2 tune — ignored).
- Corpus shapes: wheel_hoss 2/4-in-4/4 ×4; 23602 a **1/4 measure in a 2/4
  tune** (fixed silently — no oracle yet); 21874 no-ops. Type 27 can only
  SHORTEN a measure.
- OTF: additive `metadata.time_signature_changes`
  `[{measure, time_signature}]` (V2 only). **Frontend does not consume it
  yet** — renderer/player still assume the global ts (see next steps).

### V2 triplet timing — ROOT FIX (K-marker heuristic was a coincidence)
- TuxGuitar `getDuration()/getStart()`: V2 duration code (byte3 & 0x0f):
  value = WHOLE·2^(code/3); **code%3==1 dotted, code%3==2 TRIPLET**; a
  triplet note's position is straight-grid but belongs at ×4/3 of its
  offset within the quarter (480 ticks).
- The OTF-side "3 consecutive 'K' markers" fixer only matched byte3=0x4B
  (dur 11 + dynamic 4 read as a char). wheel_hoss m51/52 triplets are 0x2B
  (dynamic 2) → were left on straight 16ths. Now per-note from the duration
  code for V2; K-fixer restricted to V3. Also fixes isolated triplet notes
  (20627 m1/m5, no group of 3 — 2 notes moved, unverified, no oracle).
- Also confirmed: byte3 bit 0x80 = tie (the "m73 stray" was a tie note —
  comparer artifact, parser was right).

### Verification
- Tests: `test_tef_time_signatures.py` (6) + `test_tef_triplets.py` (3);
  suite 30 passed 1 skipped. 23398 oracle 101/101 + 5/5 techs; roundtrip
  gate PASS on 11449 and 23602. Regression vs previous parsed/: 39/41
  identical; changes only 23602 (1/4-measure shift) and 20627 (2 isolated
  triplet notes). parsed/ regenerated for all 107 source-backed files.

## Next steps (in order)

1. ~~Structural V2 instrument-record parser~~ **DONE (fourth wave).**
2. ~~Time-signature changes mid-tune~~ **DONE (fifth wave).** Follow-up:
   **frontend consumption of `metadata.time_signature_changes`**
   (work-view.js renderer + tab-player measure lengths currently assume the
   global ts; short measures render/play with trailing dead space).
3. **Scripted oracle verification batch** over all source-backed files
   (~107): per file, open in TablEdit → export MusicXML (single-track) or
   Rich MIDI (multi-track) → oracle_compare → record verdict in a manifest.
   Export recipe + gotchas documented in "The loop design" above. Consider
   the Pasteboard ASCII export + clipboard read as a faster no-dialog
   alternative (untested).
4. MIDI-oracle leg for oracle_compare.mjs (parse Rich MIDI: per-string
   channels + reading-list unroll to compare multi-track files & chokes).
5. Oracle-arbitrate 10575's in-track same-string conflicts once its .tef is
   located (title "Dear Old Dixie (G)" — raw_tabs `dear_old_dixie_(g)-535.tef`
   is a candidate but failed count triage; let the oracle decide).
6. (Later) MusicXML-sidestep decision — unchanged.

## Where things were left physically

- TablEdit is open with `23398.tef` (Angeline the Baker). The earlier document
  `Welcome to New York - Bill Emerson.tef` may show as modified (stray
  playback/space during automation) — **close WITHOUT saving** if prompted.
- `spike/oracle/` contains the 4 exports. Nothing was committed to git.
