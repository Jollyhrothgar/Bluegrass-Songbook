# G22: bars per row on a tab

Fix-it item G22. Mike, 2026-10-31: "We already have a mech that increases the
size which is great and works well, but I think another option to increase /
decrease bars per row, relative to the automatically selected number, could
be cool."

## What the reader gets

- **Where:** a "Bars per row" row in the tab's Display sheet (the reading dock,
  G19c), next to Size: **− Auto (4) +**.
- **The buttons:** − and + mean one bar fewer or more than the automatic
  count. Tapping "Auto" resets. The label shows the count in use and says
  "Auto" when there is no offset.
- **Remembered as an offset,** in its own localStorage key, not as a number.
  "+1" means one more bar than fits naturally, so the same choice works on a
  phone (auto might be 2) and on a desktop (auto might be 5).
- **Limits:** the count stays within 1–8. − is disabled at 1, and + is
  disabled at 8 or when another bar would make every bar narrower than a hard
  floor.
- **Bars get narrower to fit,** the way Size scales things. A row never runs
  off the side of the screen.
- **The same idea as the chord chart's "Cells per row"** in the lyrics'
  Display sheet.

## How

- **The renderer** already takes `measuresPerRow: 'auto' | n` (1–8) and
  works out the auto count in `TabRenderer._autoRowFit`.
  - Add the reader's offset on top of auto, so it re-fits on resize. That
    can be a `measuresPerRowOffset` option, or the song page resolving auto
    + offset to a number on each layout. Pick the simpler.
  - A count above what fits uses `availableWidth / n` down to a hard floor,
    instead of being clamped up to `minMeasureWidth` and overflowing.
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
