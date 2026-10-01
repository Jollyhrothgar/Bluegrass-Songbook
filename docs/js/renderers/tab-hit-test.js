// Hit-testing for rendered tablature: map a point in a stave-row's SVG
// coordinate space back to a musical position.
//
// Lives in renderers/ (not otf-editor/) because READING-view playback needs it
// too (tab-playback-interactions.js: click-to-arm, drag-to-loop). When it lived
// beside the editor's cursor, playing a tab dragged in the whole editor state
// machine (otf-editor/state + facade + cursor, ~170 KB) just for one pure
// function. otf-editor/cursor.js re-exports it, so the editor and its tests
// keep importing it from there.

/**
 * Map a point in a stave-row's SVG coordinate space to an edit position,
 * using the renderer's real per-measure geometry (TabRenderer rowData
 * measures: {display, x, width, ticks, noteX0, noteW, noteOffset}).
 *
 * Ts-aware for free: each geom carries its own tick length, so clicks in
 * a short 2/4 measure of a 2/2 tune land on that measure's grid. X is
 * clamped into the row; y snaps to the nearest string.
 *
 * @returns {{measure: number, tick: number, string: number}|null}
 */
export function positionFromSvgPoint(geoms, x, y, {
    topMargin,
    stringSpacing,
    stringCount,
    gridSubdivision,
}) {
    if (!geoms || geoms.length === 0) return null;

    let geom = geoms.find(g => x >= g.x && x < g.x + g.width);
    if (!geom) {
        geom = x < geoms[0].x ? geoms[0] : geoms[geoms.length - 1];
    }

    const noteX0 = (geom.noteX0 ?? geom.x + 15) + (geom.noteOffset ?? 0);
    const noteW = geom.noteW ?? geom.width - 30;
    const ratio = Math.max(0, Math.min(1, (x - noteX0) / noteW));
    let tick = Math.round(ratio * geom.ticks / gridSubdivision) * gridSubdivision;
    if (tick >= geom.ticks) {
        tick = Math.floor((geom.ticks - 1) / gridSubdivision) * gridSubdivision;
    }

    const stringIndex = Math.round((y - topMargin) / stringSpacing);
    const string = Math.max(1, Math.min(stringCount, stringIndex + 1));

    return { measure: geom.display, tick, string };
}
