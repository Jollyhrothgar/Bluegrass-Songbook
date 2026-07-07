// Keep the selected syllable/chip clear of the docked chord palette.
//
// The bottom-docked palette (especially with the root+quality picker
// expanded) can cover the line being edited. After every render — and when
// the picker expands/collapses — the orchestrator calls
// scrollSelectionClear() to nudge the scroller so the selection sits
// comfortably above the palette. The occlusion math lives in the pure
// computeScrollAdjustment() so it can be unit tested without layout.

/** Comfortable gap (px) between the selection and the palette/toolbar edge. */
export const SCROLL_GAP = 20;

/**
 * How far the scroller must move (positive = scroll down, negative = up) so
 * a selection spanning [selTop, selBottom] (viewport coords) clears the
 * visible band [topLimit, bottomLimit] with a comfortable gap.
 *
 * Returns 0 when the selection is already fully visible, so consecutive
 * picks on the same line never cause a jump.
 */
export function computeScrollAdjustment({ selTop, selBottom, topLimit, bottomLimit, gap = SCROLL_GAP }) {
    if (selBottom > bottomLimit) return selBottom - bottomLimit + gap;
    if (selTop < topLimit) return selTop - topLimit - gap;
    return 0;
}

/** Nearest scrollable ancestor, or null when the window is the scroller. */
export function findScrollContainer(el) {
    for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
            return node;
        }
    }
    return null;
}

/**
 * Scroll so selectedEl is visible between the sticky toolbar and the docked
 * palette. Smooth unless the user prefers reduced motion. No-op (returns 0)
 * when the element is already fully visible. Returns the applied delta.
 */
export function scrollSelectionClear({ selectedEl, paletteEl, stickyTopEl, gap = SCROLL_GAP }) {
    if (!selectedEl || !selectedEl.isConnected) return 0;
    const selRect = selectedEl.getBoundingClientRect();
    const scroller = findScrollContainer(selectedEl);
    const scrollerRect = scroller ? scroller.getBoundingClientRect() : null;
    const viewTop = scrollerRect ? scrollerRect.top : 0;
    const viewBottom = scrollerRect
        ? scrollerRect.bottom
        : (window.innerHeight || document.documentElement.clientHeight);

    // The palette occludes everything below its top edge (when shown).
    let bottomLimit = viewBottom;
    const paletteRect = paletteEl ? paletteEl.getBoundingClientRect() : null;
    if (paletteRect && paletteRect.height > 0) bottomLimit = Math.min(bottomLimit, paletteRect.top);

    // The sticky toolbar occludes everything above its bottom edge.
    let topLimit = viewTop;
    const stickyRect = stickyTopEl ? stickyTopEl.getBoundingClientRect() : null;
    if (stickyRect && stickyRect.height > 0) topLimit = Math.max(topLimit, stickyRect.bottom);

    const delta = computeScrollAdjustment({
        selTop: selRect.top, selBottom: selRect.bottom, topLimit, bottomLimit, gap
    });
    if (delta === 0) return 0;

    const reduceMotion = typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const opts = { top: delta, behavior: reduceMotion ? 'auto' : 'smooth' };
    if (scroller) scroller.scrollBy(opts);
    else window.scrollBy(opts);
    return delta;
}
