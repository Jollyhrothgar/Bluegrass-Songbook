// Pure geometry for drag-and-drop section reordering. The pointer state
// machine lives in the orchestrator (visual-editor.js); everything that
// maps coordinates to indices lives here so it can be unit tested without
// layout (jsdom has no real rects).
//
// Coordinate space: all Y values are relative to the cards host
// (.ve-cards, position:relative), captured once at drag start via
// offsetTop/offsetHeight. Layout doesn't change during a drag — the lifted
// card only gets a CSS transform — so the snapshot stays valid; page
// scrolling is absorbed by re-measuring the host's viewport top each move.

/** Long-press duration (ms) before a touch on the handle lifts the card. */
export const LONG_PRESS_MS = 350;
/** Touch movement (px) before the long-press timer that cancels the lift. */
export const DRAG_SLOP_PX = 8;
/** Distance from the viewport edge (px) where drag auto-scroll kicks in. */
export const DRAG_EDGE_PX = 64;
/** Max auto-scroll speed (px per frame) at the very edge. */
export const DRAG_MAX_STEP = 24;

/**
 * Final index the dragged card should land at, given the pointer Y.
 * `rects` is the drag-start snapshot ({top, bottom} per card, current DOM
 * order, dragged card included); a card counts as "passed" once the pointer
 * is below its midpoint. Returns 0..rects.length-1.
 */
export function computeTargetIndex(rects, draggedIndex, pointerY) {
    let target = 0;
    rects.forEach((r, i) => {
        if (i === draggedIndex) return;
        if (pointerY > (r.top + r.bottom) / 2) target++;
    });
    return target;
}

/**
 * Y (host coords) where the drop indicator line sits for a target index:
 * the middle of the gap the card would land in.
 */
export function indicatorY(rects, draggedIndex, targetIndex) {
    const others = rects.filter((_, i) => i !== draggedIndex);
    if (others.length === 0) return rects[draggedIndex] ? rects[draggedIndex].top : 0;
    if (targetIndex <= 0) return others[0].top - 2;
    if (targetIndex >= others.length) return others[others.length - 1].bottom + 2;
    return (others[targetIndex - 1].bottom + others[targetIndex].top) / 2;
}

/**
 * Auto-scroll velocity (px per frame; negative = up) when the pointer is
 * within `edge` px of the visible band [viewTop, viewBottom]. Speed ramps
 * linearly from 0 at the band edge to `maxStep` at the boundary.
 */
export function computeDragScroll(pointerY, viewTop, viewBottom,
    edge = DRAG_EDGE_PX, maxStep = DRAG_MAX_STEP) {
    if (pointerY < viewTop + edge) {
        const depth = Math.min(viewTop + edge - pointerY, edge);
        return -Math.ceil(depth / edge * maxStep);
    }
    if (pointerY > viewBottom - edge) {
        const depth = Math.min(pointerY - (viewBottom - edge), edge);
        return Math.ceil(depth / edge * maxStep);
    }
    return 0;
}
