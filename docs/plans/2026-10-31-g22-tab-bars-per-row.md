# G22: bars per row on a tab

Fix-it item G22. Mike, 2026-10-31: "We already have a mech that increases the
size which is great and works well, but I think another option to increase /
decrease bars per row, relative to the automatically selected number, could
be cool."

## What the reader gets (revised 2026-10-31, after Mike tried it)

The first build stored an offset from the automatic count. Mike found it acted
like a bar-width setting: "if I set rows to 2 and then make the window broader,
it eventually rolls over to 3." He asked for "some kind of hybrid with an auto
button", where Auto itself reads the music: "if there's a ton of 64th notes …
the auto should make the bars a bit wider because otherwise the notes will be
horridly cramped."

- **The control:** a "Bars per row" row in the tab's Display sheet, next to
  Size: **[Auto] − n +**.
- **Auto, the default, reads the music.**
  - Each bar's needed width comes from its notes: the bar's length divided by
    its smallest gap between note onsets, times a readable minimum spacing per
    note. That spacing scales with Size, and the bar never goes below today's
    `minMeasureWidth`.
  - The tab's needed width is the 90th percentile of its bars, so one freak
    bar doesn't shrink the whole tab.
  - The count is as many of those as fit, from 1 to 8. Bars keep one uniform
    width (`uniformMeasureWidth`), so barlines still line up row over row.
  - Auto re-fits when the window changes size.
- **Manual:**
  - − or + leaves Auto from the count Auto had chosen, and sets an exact
    count.
  - That count stays the same when the window changes, and the bars stretch
    to fill the row.
  - If the window gets too narrow for that many bars at the hard floor (90px),
    the row temporarily shows the most that fit. The label says so, e.g. "4 ·
    3 fit". The chosen count comes back when there's room.
  - Tapping **Auto** returns to Auto.
- **Memory:** each window or browser tab keeps its own choice
  (`sessionStorage`), so several windows can each be set for their own size.
  The latest choice, Auto included, is also kept in `localStorage` and seeds
  any new window.
- **The rows fill the width** in both modes.
- **The buttons never move:** the label has a fixed width.

## How

- **The renderer** already takes `measuresPerRow: 'auto' | n` (1–8) and
  works out the auto count in `TabRenderer._autoRowFit`.
  - Add the reader's offset on top of auto, so it re-fits on resize. That
    can be a `measuresPerRowOffset` option, or the song page resolving auto
    + offset to a number on each layout. Pick the simpler.
  - A count above what fits uses `availableWidth / n` down to a hard floor,
    instead of being clamped up to `minMeasureWidth` and overflowing.
- **Auto's needed width** is computed in the renderer from the notation it already has. Keep it pure and unit-tested, e.g. `TabRenderer.neededMeasureWidth(notation, opt)`.
- **The editor stays put.** Pressing Edit must not reflow the page. The
  editor pins its row shape once (`otf-editor/editor.js`
  `_pinMeasuresPerRow`) from its own `measuresPerRow` option, else from
  `autoMeasuresPerRow()`.
  - So the song page's `mountTabEditor` passes the reader's effective count
    as the editor's `measuresPerRow` option. No change inside `otf-editor/`.
  - `mountTabEditor` is a seam shared with the tab editor session, so tell
    it.
- **Only the reading band gets the control.** The editing band keeps G17's
  layout.

## Tests

- **Unit:** the fit with an offset (clamping, the hard floor, the disabled
  ends); the offset is remembered.
- **E2E:**
  - + and − change the number of bars in the first row, and the count shows
    in the label;
  - Auto resets;
  - the choice survives a reload;
  - nothing overflows sideways at 360px or 1440px;
  - pressing Edit after +1 keeps the same bars in the first row.
