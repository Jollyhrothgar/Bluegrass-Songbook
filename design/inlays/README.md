The flying eagle pattern: the traditional peghead and fingerboard inlay set on pre-war style banjos, and the source of the scrollwork in the BB mark. Each file is one inlay as a single-colour silhouette in `currentColor`, so it follows `text` (or any token) in either theme when placed inline or used as a mask.

- `peghead.svg`: the full peghead set (diamond, horns, fleur, the two eagles, teardrop, side scrolls). About 70 x 131 mm on a banjo.
- `diamond.svg`: the small diamond from the top of the peghead. A good small mark: a bullet, a current-position marker, a list-section ornament.
- `marker-01.svg` to `marker-10.svg`: the fingerboard position markers, in the order of the reference photo (top to bottom). Sizes on a banjo run from about 25 x 22 mm to 36 x 9 mm; the wide ones (04 to 10) suit horizontal ornaments, the square ones (01 to 03) suit a single mark.

Real inlays come in white pearl, gold pearl and abalone. Those three materials are a natural source for the few colours the design uses.

Traced from a supplier's product photo (luthiersupply.com, "Flying Eagles Peg Head and Fret Board Inlays") at roughly 0.2 mm per pixel, so edges are approximate. Redraw by hand before using one large or in print. The design system ("Bluegrass Book" in Claude Design) holds the same files in its Inlays group.

Use them as ornaments with a meaning (where you are, where a section starts, an empty state), sparingly, and never as icons for actions.

## Re-tracing

`trace.py` masks the white-pearl column of the photo, splits it into rows,
and traces each row with potrace (`brew install potrace`; Pillow for the
rest). The photo is not committed. To re-run:

    curl -sL "https://luthiersupply.com/image/data/Products/Banjo%20Page/Flying%20Eagles%20Full.jpg" -o eagles.jpg
    mkdir -p pbm svg && python3 trace.py

The BB mark without its square is `design/logo/bb-mark.svg`.
