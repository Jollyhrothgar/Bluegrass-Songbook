// Anchored popover placement for the chord palette on wide (side-by-side)
// layouts. Pure rect math in the style of autoscroll.js: the DOM layer
// measures getBoundingClientRect() and this module decides where the
// popover goes, so the decisions are unit-testable without layout.
//
// Contract: prefer directly below the target (reads like a dropdown);
// flip above when below would overflow the viewport; when neither side
// fits at natural height, take the roomier side and shrink to it (callers
// apply maxHeight so the content scrolls internally) — the popover NEVER
// covers its anchor line. Horizontally the popover is centered on the
// target but clamped inside the anchor pane so it never drifts over the
// raw-text pane or off screen.

/** Gap (px) between the target and the popover edge. */
export const POPOVER_GAP = 8;
/** Breathing room (px) from pane and viewport edges. */
export const POPOVER_MARGIN = 8;

/**
 * Where should a popover of popWidth x popHeight go, anchored to
 * targetRect (viewport coords), constrained horizontally to paneRect and
 * vertically to the viewport?
 *
 * popHeight must be the NATURAL (unconstrained) height — callers clear any
 * previous maxHeight before measuring. Returns { left, top, placement,
 * maxHeight } with placement 'below' | 'above'; maxHeight is the vertical
 * room on the chosen side, so applying it makes an oversized popover end
 * exactly at the viewport edge and scroll internally. All outputs are
 * viewport (position:fixed) coordinates.
 */
export function computePopoverPosition({
    targetRect, popWidth, popHeight, paneRect, viewportHeight,
    gap = POPOVER_GAP, margin = POPOVER_MARGIN
}) {
    // Horizontal: centered on the target, clamped into the pane. When the
    // popover is wider than the pane, pin it to the pane's left edge.
    const minLeft = paneRect.left + margin;
    const maxLeft = paneRect.right - popWidth - margin;
    let left = targetRect.left + targetRect.width / 2 - popWidth / 2;
    left = Math.max(minLeft, Math.min(left, Math.max(minLeft, maxLeft)));

    // Vertical: below if it fits, else above if it fits, else whichever
    // side has more room — shrunk to that room (internal scroll).
    const roomBelow = viewportHeight - margin - (targetRect.bottom + gap);
    const roomAbove = targetRect.top - gap - margin;
    const placement = popHeight <= roomBelow ? 'below'
        : popHeight <= roomAbove ? 'above'
            : (roomBelow >= roomAbove ? 'below' : 'above');
    const maxHeight = Math.max(0, placement === 'below' ? roomBelow : roomAbove);
    const height = Math.min(popHeight, maxHeight);
    const top = placement === 'below'
        ? targetRect.bottom + gap
        : targetRect.top - gap - height;
    return { left, top, placement, maxHeight };
}

/**
 * Vertical anchor for a chip/syllable selection: horizontally the popover
 * centers on the target itself, but vertically it must clear the WHOLE
 * line (chord row + lyric row). Anchoring below a chip alone would drop
 * the popover onto that line's lyrics, swallowing taps on its siblings.
 */
export function anchorRectFor({ targetRect, lineRect }) {
    if (!lineRect) return targetRect;
    return {
        left: targetRect.left,
        width: targetRect.width,
        top: Math.min(targetRect.top, lineRect.top),
        bottom: Math.max(targetRect.bottom, lineRect.bottom)
    };
}
