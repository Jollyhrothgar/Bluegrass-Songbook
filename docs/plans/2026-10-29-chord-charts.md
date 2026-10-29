# Chord charts: a song's harmony with timing, and a band to practice with

**Date:** 2026-10-29 (decided with Mike in conversation, 2026-10-28 and 29) ·
**Status:** design only, nothing built · **Fix-it list:** G18 ·
**Branch:** `feature/chord-charts` ·
**Mockup:** `design/ui-states/proposed/g18-chord-chart-cells.html` (cells and barring) ·
**Related:** D4 (setlist overrides), D8 (arrangement markup), E1 (one ChordPro core),
E3 (keyboard chord entry)

## The problem

Bluegrass Book is a fakebook: lyrics and chords are a song's shorthand. They
say *which* chords, not *how long* each one lasts. Of the 19,148 lead sheets
on 2026-10-28, 9 had bar lines, none had a tempo, and 29 declared 3/4. So the
book cannot:

- show a song's harmonic structure at a glance, the way a musician reads a
  chord chart;
- play the song back for practice;
- catch a chart that contradicts itself. Old Home Place's verse 2, line 3
  reads `[A]I ran [C#7]away to [A][D]Charlottesville` (`A C#7 A D`), where
  verses 1, 3 and 4 read `A C#7 D A`. Both have four chords, so nothing that
  counts chords notices.

Tabs and ABC tunes do carry timing, but a tab usually covers one solo, and
neither says anything about a song's chords as a whole.

## What a chord chart is

A chord chart with meter hints, each section written once, built from two
units (Mike, 2026-10-29):

- A **slot** is one bass note. It holds a chord, or `\` to keep playing the
  chord before it.
- A **cell** is the beat pattern: **boom-chuck boom-chuck** (two slots) by
  default, **boom-chuck-chuck** (one slot) in 3/4. 6/8 has two slots a cell.

Old Home Place, as numbers, one cell per bar (each line is one lyric line in
this song):

```
Verse
| I \ | III7 \ | IV \ | I \ |
| \ \ | \ \    | V \  | \ \ |
| I \ | III7 \ | IV \ | I \ |
| \ \ | V \    | I \  | \ \ |
Chorus
| V \   | \ \    | I \  | \ \ |
| II7 \ | \ \    | V \  | \ \ |
| I \   | III7 \ | IV \ | I \ |
| \ \   | V \    | I \  | \ \ |
```

Inside that grid:

- **Two chords in a cell** fill both slots (`| D G |`).
- **A slot can be split** when the chord changes between bass notes: two
  quarter-note chords in a duple slot, three in a 3/4 slot.
- **A short cell is a meter change for that one bar.** `| G |` in a duple
  chart is a 2/4 bar, drawn with a small time signature: the way crooked
  fiddle tunes are written. A 3/4 bar can sit in a duple song and the other
  way round. Bars don't have to add up.
- **Push and effects.** A push anticipates a chord by an eighth note. A stop
  strums and mutes, let ring sustains, and a rest leaves the slot silent. They
  change both what is drawn and what is played.
- **Any chord a lyric chart can hold.** The lead-sheet picker plus a free-text
  fallback checked by `isValidChord` (`docs/js/chords.js`). Comparing a chart
  with its lyric chart must never flag a chord the chart simply can't spell.

**People draw charts. Nothing generates or guesses a chord progression**
(Mike, 2026-10-28). The book's other rule applies too: nothing unproven is
shown as fact.

## Bars are a display setting

The chart stores cells. How many cells a printed bar holds is a toggle (Mike
confirmed this with the mockup, 2026-10-29):

- **One cell per bar**, the default (what Mike called 2/2): `| G \ | C \ |`.
- **Two cells per bar** (what Mike called 4/4): `| G \ C \ |`.

Converting regroups cells into bars: chords don't move and playback doesn't
change. Pairing restarts at each section, and a section with an odd number of
cells ends on a half bar when shown two to a bar.

Both are needed because tabs bar the same music both ways, and their time
signature doesn't say which. The first pitched track of each of 493 tab files
in `works/` (2026-10-29):

| Time signature | Note value | Notes a bar | Tabs | Cells a bar |
|---|---|---|---|---|
| 4/4 | eighths | 8 | 354 | one |
| 2/4 | sixteenths | 8 | 49 | one |
| 2/2 | eighths | 8 | 29 | one |
| 4/4 | sixteenths | 16 | 17 | two |
| 4/4 | quarters | 4 | 14 | unclear (mostly guitar) |
| 3/4 | various | 3, 6 or 9 | 19 | one (boom-chuck-chuck) |

So "4/4" is one cell a bar in 354 tabs and two in 17. The mockup draws the
same four cells both ways, over a 4/4 tab of each kind.

## How a chart relates to the rest of a song

The chart is the hub. Each melody source lines up with it in order, and
supplies the order the sections are played in:

| Source | Lines up with the chart by | Supplies the playing order? |
|---|---|---|
| Lyrics and chords (the primary consumer) | sections, in order | yes: the sung order |
| Tab | cells, in its unrolled reading order | for instrumentals; a partial tab covers one section |
| ABC (440 tunes on 2026-10-28) | cells, with repeats and 1st/2nd endings unrolled | yes, for fiddle tunes |

- **Lyrics and chords line up by section, not by label.** Labels are free
  text: Tennessee 1949's chart reads `Verse 1 A · Verse 1 B · Chorus · Verse 2
  A · Verse 2 B · Chorus · Verse 3 · Chorus`, and ChordPro calls the A and B
  parts both "verse". Walking the chart's sections in order and pairing each
  with the next form entry avoids parsing labels at all.
- **Tabs line up by cells, not bars.** A tab's bar holds one cell or two. The
  tab itself shows which (8 or 16 notes a bar at its note value), and so do bar
  totals. The chart then switches to the tab's barring so the two read bar for
  bar side by side.
- **Tabs are assumed partial** (Mike): a tab covers at most a verse and a
  chorus, and declares which section(s) it covers.
- **Instrumentals:** the tab or ABC relates to the chart the way lyrics do for
  a song (Mike).
- **Pickup notes** before the first downbeat don't count
  (`docs/js/renderers/measure-timing.js` already handles short measures).

## Data model

A chord chart is **its own part on the song's root work** (the work a
version's `song:` field points to), so every version of the song finds it
(Mike). It is not a block inside the `.pro`: adding a block to a chart you
didn't submit would fork that chart into a near-duplicate arrangement under
today's rules. As its own part, adding one is additive, the way tabs are.

```yaml
# Sketch: field names, file name and notation are not final.
drawn_from: lead-sheet.pro    # the lyric chart it was drawn from
meter: duple                  # duple (boom-chuck boom-chuck) | 3/4 | 6/8
sections:                     # any names, any length; one text line per chart line
  Verse: |
    | I \ | III7 \ | IV \ | I \ |
    | \ \ | \ \    | V \  | \ \ |
    | I \ | III7 \ | IV \ | I \ |
    | \ \ | V \    | I \  | \ \ |
  Chorus: |
    | V \   | \ \    | I \  | \ \ |
    | II7 \ | \ \    | V \  | \ \ |
    | I \   | III7 \ | IV \ | I \ |
    | \ \   | V \    | I \  | \ \ |
form: [Verse, Verse, Chorus, Verse, Verse, Chorus, Chorus]
```

- **In storage `|` separates cells.** The barring setting decides which of
  them are drawn as bar lines. Each text line is one chart line, so line length
  is free per line and a line can match its lyric line.
- **Sections** have any name (A, B, Chorus, Bridge, Intro, Tag) and any
  length. Don't assume 8 or 16 bars.
- **`form`** has one entry per section of the `drawn_from` chart, in order, and
  is what pairs each lyric section with a chart section. It is the sung order
  only: no breaks.
- **Repeats and endings.** A repeat count on a section (A ×2) for a plain
  repeat; **1st and 2nd endings** on a run of cells; a section marked **first
  time only** or **last time only** (an intro, an ending). Practice mode follows
  all three. For an instrumental with no tab or ABC, they give the playing
  order.
- **One key per song**, the app's rule since 2026-10-28. A modulated last
  chorus is written as its chords, read relative to the home key.
- **Not stored:** the key (it comes from the lyric chart, so the Key pill keeps
  working), tempo (a reader setting), barring (chosen by the reader, or matched
  to the tab beside it), pickups, and breaks (see "Arrangement").

## Two views: chart view and practice mode

- **Chart view** shows each section once: the minimal chart a musician
  references.
- **Practice mode** unrolls the playing order from the lyric chart, tab or ABC
  and plays it once through or on a loop. Old Home Place plays verse, verse,
  chorus, verse, verse, chorus, chorus, because that is how its lyric chart is
  laid out.
- The tab view already does this: **Unrolled | Repeats**
  (`docs/js/work-view.js`, `.tab-repeat-group`). Playback always follows the
  unrolled reading order, even while the display shows written measures; the
  cursor mapping between the two is already solved there. Charts reuse the
  idea and the words.
- In practice mode the lyric section being played is highlighted (sections
  line up by order). Highlighting the exact lyric line needs lines tied to
  bars: a later, optional layer.

## Checking a source against the chart

The chart doubles as a proofreader. Mismatches are **flagged, never
auto-fixed**; which side is wrong is a person's call.

- **Lyrics and chords:** each lyric section's chords, with repeated chords
  collapsed, compared as numbers with the chart section it lines up with. Old
  Home Place verse 2 is the first catch.
- **Tabs and ABC:** cell counts along the unrolled order. An A A B B tune with
  8-cell parts is 32 cells whether its tab bars them one or two to a bar. The
  34 ABC tunes that carry chord symbols (2026-10-28) can be compared chord for
  chord.
- **A source that doesn't line up** (a version that drops a verse) is flagged,
  not silently mismatched.

## Arrangement belongs to set lists, not the songbook

Breaks, key, tempo and who takes which break describe how one group plays a
song, so they are not defaulted into the book (Mike). Set lists already have
a home for them: `user_list_items.metadata`
(`supabase/migrations/20260202000000_list_item_metadata.sql`), which the list
view uses today for a per-song key, tempo and notes; the migration's own
example is `"notes": "Kick: Mike solo"`. Structured breaks are a later
extension of that, alongside D4 and D8.

A tab says which section it covers (songbook data). Where that solo is played
in a performance is arrangement (set-list data).

## Entering a chart

- **The picker** is the lead-sheet editor's Chords-mode picker, reused:
  - `docs/js/lead-editor/chord-menu-model.js` is pure: the key's chords,
    outside chords, More roots, decorations, slash bass, and
    `chordFunction(chord, key)` for numerals. It already takes the chords in
    use: `chordMenuModel({ key, used, current })`.
  - `docs/js/lead-editor/chord-menu.js` (`createChordMenu`) takes callbacks:
    `getContext` (the key and the selected slot's chord), `onPick` / `onRemove`,
    `onStep` (◀ ▶ between slots, ▲ ▼ between lines). The strip, glide and
    magnifier are lyric-specific and stay off.
- **The keyboard.** Letter keys set the root, `b` and `#` alter it, quality
  keys follow, `/` starts a bass note. Space adds a cell that copies the
  current one, so typing then overwrites it: a whole line goes in without
  touching the mouse. Arrows move between slots, Shift selects, and cut, copy,
  paste and undo work on cells. E3 asks for keyboard chord entry in the
  lead-sheet editor too; one implementation should serve both.
- **A palette of the song's chords**, from the picker model's `used`.
- **Sections** use the same quick-pick names as the lyric editor's section
  bar, and can be duplicated, reordered and deleted.

## Layout

- **Desktop:** lyrics on the left, the chart on the right, generated parts
  (as tab) under the chart. Lyric sections and chart sections sit side by side.
- **Phone:** open. Either the song page's existing part tabs (Lyrics | Chart),
  or each chart line under its lyric line (four one-cell bars fit a phone
  width). Interleaving only works where a chart line really is a lyric line.
- **Display details:** a chord carried over a line break is repeated faintly
  in the next line's first slot, so you never look back up a line; the key can
  show its capo shape ("Key of A (G capo 2)"); a section shows its repeat
  count. Letters, Nashville numbers or Roman numerals are a reader setting (the
  Key pill's Nashville toggle today).

## The band: generated parts

Parts are generated in the browser from the chart as OTF tracks and played by
`TabPlayer`. Tempo, loop, metronome, count-in and the track mixer already
exist in the bottom band, and because the parts are OTF they can be read as
tab. The chart is useful with no playback at all (Mike).

Order: **bass, then guitar, then mandolin** (Mike). **No banjo**; if it ever
comes, it is roll-based.

- **Bass:** one note per slot: two a cell in duple time, one in 3/4. Barring
  doesn't change it. Which notes (root, fifth, walk-ups into a change) is not
  decided.
- **Guitar:** the chucks between the bass notes (bass note, then strum).
- **Mandolin:** the chop. The player's mandolin sound is General MIDI's
  acoustic steel guitar; GM has no mandolin.
- **Push, stop, let ring and rest** apply to every part.

## What a new part type touches

- `scripts/lib/work_schema.py` and `scripts/lib/works_writer.py` (the part
  type and how it is written).
- `scripts/lib/build_works_index.py` (publish the chart to `docs/data/`, flag
  it on the index row).
- `docs/js/renderers/index.js` `RENDERERS` and the song page's part tabs
  (`docs/js/work-view.js`).
- For user-added charts: the `pending_songs.part_type` CHECK (a migration;
  Mike pushes it), `classifyChange` in
  `supabase/functions/_shared/pending-dispatch.ts`, `scripts/lib/process_pending.py`,
  and the shared ownership table
  `supabase/functions/_shared/testdata/ownership-cases.json`.

## Order of work

1. **Data model:** the chart part, its schema, publishing it, and a few
   hand-written charts to work against (Old Home Place, Tennessee 1949,
   Cherokee Shuffle). Tests read frozen copies, never live songs
   (`.claude/rules/tests.md`).
2. **Read-only chart on the song page:** chart view, the barring toggle,
   practice-mode order, and the mismatch flags.
3. **The designer:** picker and keyboard entry, and adding a chart from the
   site.
4. **Bass.**
5. **Guitar.**
6. **Mandolin.**

Each step is useful without the next.

## Decisions (Mike, 2026-10-28 and 29)

- A slot is one bass note; `\` continues the chord. The default cell is
  boom-chuck boom-chuck (two slots); 3/4 is boom-chuck-chuck (one).
- 4/4 and 2/2 are both kept and convert easily, because tabs bar the same
  music both ways. Cells are stored, barring is a display setting, and tabs
  line up by cells.
- Lyrics and chords are the primary consumer; the chart should match them.
- The chart is its own part, associated with the song.
- People draw charts; progressions are never generated.
- Sections are written once; chart view and practice mode toggle between the
  minimal chart and the full playing order.
- Breaks and arrangement belong to set lists.
- Tabs are partial; tabs and ABC for instrumentals relate to the chart the way
  lyrics do.
- Wanted, from Mike's notes on chart editors (2026-10-29): split slots, push,
  stop / let ring / rest, a meter change on a single bar, 1st and 2nd endings,
  first-time and last-time sections, and fast keyboard entry.
- The designer comes first; then bass, guitar, mandolin. No banjo.

## Open

- **Chords stored as numbers.** Claude's recommendation (key and capo become
  display only, comparisons are key-free); not yet confirmed. If so, a minor
  key is numbered from its own tonic (1m) or from the relative major (6m).
- **The barring toggle's label:** "one cell / two cells a bar", or the time
  signature of the tab beside it. Most 4/4 tabs are one-cell bars, so "4/4"
  alone is ambiguous.
- **Starting meter:** take 3/4 or duple from the lyric chart's own `{time}`
  when it has one (416 charts declared one on 2026-10-28)?
- **Notation** for split slots, push and the effects.
- **Phone layout:** part tabs, or chart lines under lyric lines.
- **One chart per song, or takes** like tabs.
- **May a version carry its own chart or form?** Leaning no for now: one per
  song, and a version that doesn't line up is flagged.
- **Generated parts:** always computed, or saveable as a tab someone then
  edits and submits under their name.
- **Storage format** (the YAML above is a sketch).
