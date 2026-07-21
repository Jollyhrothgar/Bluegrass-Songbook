# Feasibility: Closing the TablEdit → OTF Fidelity Loop

**Question asked:** Is it feasible to finish the browser tab editor by building a
loop — author tabs in TablEdit, save the binary `.tef`, parse it, translate to
OTF, render, and compare the two — iterating until the parser is "done"? And is
that best served by building a *TablEdit CLI*, or done *visually*?

**Short answer:** The loop is feasible and worth building, but the framing should
shift. The bottleneck isn't rendering-and-eyeballing — it's the lack of a
**ground-truth oracle** and an **automated regression harness**. There is no real
TablEdit CLI to build (the app exposes no command-line export), so the practical
path is a hybrid: a hand-authored *feature-isolating* TEF corpus, exported once
from TablEdit's GUI to machine-readable formats (MIDI / ASCII / MusicXML) as
ground truth, plus two large shortcuts that let us stop reverse-engineering blind
— the **official TEF 3.0 spec** and **TuxGuitar's existing TEF reader**.

---

## 1. Where the code actually is today

The TEF→OTF pipeline already exists and works for the common case:

| Component | Location | State |
|---|---|---|
| Binary reader (V2 + partial V3) | `sources/banjo-hangout/src/tef_parser/reader.py` | 1,244 lines, hand-reverse-engineered |
| TEF→OTF conversion | `sources/banjo-hangout/src/tef_parser/otf.py` | 627 lines |
| Batch pipeline | `converter.py`, `batch_convert.py`, `batch_import.py` | working |
| OTF format spec | `docs/js/otf-editor/DESIGN.md` | stable |
| Browser editor (custom SVG) | `docs/js/otf-editor/*.js` | modal editor, "buggy, not fluid enough" per PLAN.md |
| Debug knowledge | `.claude/skills/tab-debug/SKILL.md` | excellent — captures the byte-level format lore |

Reported conversion rate: **100 of 124** priority tabs convert; **24 V3-variant
files fail** ("empty notation — no `debt` marker"). ~330 OTF files sit in
`parsed/`.

**Two things stand out:**

1. **There is no automated test/golden harness in the parser.** No `test_*.py`
   anywhere under `sources/banjo-hangout`. Every parser fix in the debug skill
   was validated by loading a file and looking at it. That is exactly the manual
   grind you're describing — and it's the thing to fix first.

2. **There's a strategic fork in the repo.** `PLAN.md` documents a pivot away
   from the custom SVG renderer/editor toward **AlphaTab** (see
   `docs/alphatab-spike.html`, `docs/js/alphatab/otf-to-tex.js`), and it
   explicitly labels TEF reverse-engineering a *"separate concern that already
   works for 100+ files."* Your request re-opens that concern. That's fine — TEF→OTF
   fidelity is orthogonal to which renderer draws the OTF — but we should be
   deliberate: are we hardening the *ingest* pipeline (TEF→OTF), the *editor*, or
   both? They're different projects. This doc is about ingest fidelity, which is
   what the "compare the two" loop is really testing.

---

## 2. The real problem: there is no oracle

Today the parser's correctness is judged against a human looking at a rendered
tab. That doesn't scale and isn't reproducible. To "loop until it's done" you
need a machine-checkable definition of *done* for each file. That means an
**oracle**: an independent source of truth for what notes/timing/articulations a
`.tef` actually contains. Three oracles are available, in increasing order of
leverage:

### Oracle A — TablEdit's own exports (ground truth, per file)
TablEdit exports **MIDI, ASCII tab, ABC, Lilypond**, and (in 3.x) **MusicXML**.
These are the authoritative interpretation of a file, straight from the vendor's
own engine. MIDI gives you pitch + timing; ASCII gives you string/fret layout;
MusicXML gives you both plus articulations. Compare *our* OTF against these and
disagreements are unambiguous parser bugs.

### Oracle B — TuxGuitar's TEF reader (independent implementation)
TuxGuitar ships a `TuxGuitar-tef` module (Java) that reads `.tef` and can export
MusicXML/Guitar Pro. MuseScore 4 also imports TEF 3.00+. These are **existing,
working, open-source TEF parsers**. Cross-referencing our output against a second
independent parser catches bugs neither of us would catch alone, and reading
their source is faster than staring at hex. (Check license before porting code —
read for reference regardless.)

### Oracle C — The official TEF 3.0 format specification
A formal spec for the TablEdit 3.0 file format has existed since ~2020, and the
TablEdit author is known to share it with developers building importers (MuseScore
and TuxGuitar both got it). **This is the single highest-leverage item in this
whole effort.** The 24 failing V3 files fail because the V3 sub-format was guessed
at, not specified. Getting the spec likely turns "reverse-engineer the `debt`-less
V3 variant by hand" into "implement the documented chunk layout."

---

## 3. CLI vs. visual — the verdict

**You can't build a TablEdit CLI.** TablEdit has no documented command-line or
scriptable batch-export interface. Its closest feature is the *Tablature Manager*,
which batch-exports *selected* files with current options — but it's GUI-driven.
So "build a tabledit CLI" as literally stated isn't on the table for the vendor app.

**But the visual/manual export only has to happen once per fixture.** The winning
shape is a hybrid:

- **Authoring + export from TablEdit = GUI, one-time, small.** You hand-build a
  library of tiny *feature-isolating* `.tef` files (one technique each) and export
  each to MIDI + ASCII (+ MusicXML if on 3.x). This is a fixed corpus of maybe
  30–60 files, done once. It can be driven by desktop automation (computer-use can
  open TablEdit, File→Export, pick format) but honestly may be faster by hand the
  first time.
- **Everything downstream = a real automated harness (the "CLI" you actually
  want).** `python parse.py fixture.tef` → OTF, then diff OTF against the exported
  MIDI/ASCII oracle. This is the loop, and it's fully scriptable.

So: *no CLI for TablEdit; yes CLI for our own parse-and-compare harness; visual
only for authoring fixtures and final QA screenshots.*

---

## 4. Proposed architecture of the loop

```
                 author once (GUI)          reverse-engineer / iterate (CLI)
  ┌───────────────┐   TablEdit   ┌──────────┐   reader.py+otf.py   ┌─────────┐
  │ feature TEF   │─────────────▶│ .tef bin │────────────────────▶│  OTF    │
  │ fixtures      │              │  +       │                     │  JSON   │
  │ (1 technique  │   File→Export│ MIDI/    │                     └────┬────┘
  │  each)        │─────────────▶│ ASCII/   │                          │
  └───────────────┘  (oracle)    │ MusicXML │                          │
                                 └────┬─────┘                          │
                                      │  normalize to a common         │
                                      ▼  "note list" (pitch,           ▼
                                 ┌─────────────────────────────────────────┐
                                 │  compare_harness.py                      │
                                 │  assert OTF notes == oracle notes        │
                                 │  → per-fixture pass/fail + diff report   │
                                 └─────────────────────────────────────────┘
                                      │ visual QA (optional)
                                      ▼
                    TEFview screenshot   vs.   our renderer (SVG / AlphaTab)
```

**Fixture corpus** — each file isolates one thing so a failure points at one bug:
single note per string, each duration, hammer-on, pull-off, slide, bend, tie,
triplet, chord, 2/4 vs 4/4 vs 3/4, a repeat/reading-list, capo, alternate tuning,
multi-track ensemble, and — critically — several **V3-format** files (both the
`debt` variant we handle and the one we don't).

**Comparison layer** — the trick is normalization: reduce both our OTF and the
oracle to a canonical `(measure, position, string, fret, pitch, duration,
articulation)` list and diff those. MIDI gives pitch+timing cheaply; ASCII gives
string/fret; MusicXML gives the richest match. Start with MIDI (pitch/timing
regressions are the most common and most damaging) and layer ASCII/MusicXML in.

**This replaces "render and eyeball" with a pass/fail test suite** — the actual
enabler for "loop until done."

---

## 5. Recommended sequence

1. **Get the TEF 3.0 spec** (email the TablEdit author) and **pull TuxGuitar-tef
   source** for reference. Do this first — it may collapse the V3 work by an order
   of magnitude. Low effort, highest leverage.
2. **Confirm the tooling exists on your Mac** — is TablEdit (authoring) and/or the
   free **TEFview** (rendering ground truth) installed? This decides whether we can
   author new fixtures or must rely on the ~45 existing downloaded `.tef` files. I
   can check this via desktop access if you want.
3. **Build the compare harness** against MIDI first, wire it to the existing
   `tef_parser`, and backfill fixtures from the files we already have (turn the
   24 known V3 failures into failing test cases).
4. **Author the feature-isolating fixture corpus** in TablEdit and export oracles.
5. **Iterate the parser** against the now-automated suite until green, starting
   with the V3 variant.
6. **Visual QA** last: TEFview screenshot vs. our render for a handful of real
   tunes, as a final human check — not the primary loop.

---

## 6. Risks & unknowns

- **AlphaTab pivot tension.** If the site is moving to AlphaTab, note AlphaTab has
  no native TEF import — so TEF→OTF stays our job either way, but the *renderer*
  side of "compare the two" should target whichever renderer you're keeping. Worth
  settling before investing in the SVG editor specifically.
- **Spec access.** The whole V3 shortcut depends on the author sharing the spec.
  If he doesn't, we're back to reverse-engineering, but TuxGuitar-tef still helps.
- **Export fidelity of the oracle.** TablEdit's MIDI/ASCII export is itself lossy
  (e.g. tempo changes "partially covered" in the spec). MusicXML is richer. No
  single oracle is complete — hence layering them.
- **License.** TuxGuitar/MuseScore code is GPL/LGPL-family; fine to *read* for
  understanding, check terms before copying code into this MPL/your-licensed repo.
- **Format detection.** Quick inspection shows downloaded `.tef` files begin with
  the title string, not a clean magic number, so V2/V3 discrimination lives deeper
  in the header — the harness should assert on detected version per fixture.

---

## 7. Effort estimate (rough)

| Piece | Effort |
|---|---|
| Obtain spec + TuxGuitar source review | hours–days (mostly waiting on email) |
| Compare harness (MIDI-based) + wire to parser | ~1–2 days |
| Fixture corpus authoring + GUI export | ~1 day (once TablEdit confirmed) |
| V3 variant parser work (with spec) | ~2–4 days |
| V3 variant parser work (without spec) | ~1–2 weeks, uncertain |
| Visual QA tooling | ~0.5 day |

The loop is very feasible. The single decision that most changes the cost is
whether we get the official V3 spec — so I'd start there.
