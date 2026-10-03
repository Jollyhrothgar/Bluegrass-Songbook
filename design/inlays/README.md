The flying eagle pattern: the traditional fingerboard inlays on pre-war style banjos, and the source of the scrollwork in the BB mark. (The peghead set is left out on purpose.) Each file is one inlay as a single-colour silhouette in `currentColor`, so it follows `text` (or any token) in either theme when placed inline or used as a mask.

- `diamond.svg`: the small diamond from the top of the peghead. A good small mark: a bullet, a current-position marker, a list-section ornament.
- `marker-01.svg` to `marker-10.svg`: the fingerboard position markers, in fingerboard order from the peghead down (marker-02 is two stacked pieces). Sizes on a banjo run from about 25 x 22 mm to 36 x 9 mm; the wide ones (04 to 10) suit horizontal ornaments, the square ones (01 to 03) suit a single mark.

Real inlays come in white pearl, gold pearl and abalone. Those three materials are a natural source for the few colours the design uses.

Traced from a photo of a full set laid in ebony (an eBay listing image, 1600 px square, about 0.1 mm per pixel). Each shape is averaged with its mirror image, so it is exactly symmetric, and smoothed by about one source pixel; fine points and the notched teeth in 08 and 10 survive. Good to around 300 px wide; redraw by hand before printing one large.

Use them as ornaments with a meaning (where you are, where a section starts, an empty state), sparingly, and never as icons for actions.

## Re-tracing

`trace.py` crops each marker from the photo, maps ebony to 0 and pearl to 1,
removes the wood's 1-2 px grain lines, averages each shape with its mirror,
smooths it, cuts at 0.5, fills enclosed holes and traces with potrace
(`brew install potrace`; numpy and Pillow via uv). The photo is not
committed. To re-run:

    curl -sL "https://i.ebayimg.com/images/g/~jQAAOSwSbFkt0W5/s-l1600.jpg" -o ebay.jpg
    mkdir -p pbm4 svg && uv run --with numpy --with pillow python trace.py svg

The BB mark without its square is `design/logo/bb-mark.svg`.
