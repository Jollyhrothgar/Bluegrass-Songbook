// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    computeScrollAdjustment, findScrollContainer, scrollSelectionClear, SCROLL_GAP
} from '../visual-editor/autoscroll.js';

describe('computeScrollAdjustment', () => {
    const band = { topLimit: 50, bottomLimit: 500 };

    it('returns 0 when the selection is fully visible (no jumpiness)', () => {
        expect(computeScrollAdjustment({ selTop: 100, selBottom: 130, ...band })).toBe(0);
        // exactly at the limits still counts as visible
        expect(computeScrollAdjustment({ selTop: 50, selBottom: 500, ...band })).toBe(0);
    });

    it('scrolls down when the selection is occluded by the palette', () => {
        // selection bottom 40px past the palette top → scroll it 40px + gap
        expect(computeScrollAdjustment({ selTop: 510, selBottom: 540, ...band }))
            .toBe(40 + SCROLL_GAP);
    });

    it('scrolls down when the selection is entirely below the fold', () => {
        expect(computeScrollAdjustment({ selTop: 900, selBottom: 930, ...band }))
            .toBe(430 + SCROLL_GAP);
    });

    it('scrolls up when the selection is above the visible band', () => {
        expect(computeScrollAdjustment({ selTop: 10, selBottom: 40, ...band }))
            .toBe(-40 - SCROLL_GAP);
    });

    it('respects a custom gap', () => {
        expect(computeScrollAdjustment({ selTop: 510, selBottom: 540, ...band, gap: 8 }))
            .toBe(48);
    });

    it('after applying the delta the selection sits gap px above the palette', () => {
        const sel = { selTop: 700, selBottom: 720 };
        const delta = computeScrollAdjustment({ ...sel, ...band });
        expect(sel.selBottom - delta).toBe(band.bottomLimit - SCROLL_GAP);
    });
});

describe('findScrollContainer', () => {
    afterEach(() => { document.body.textContent = ''; });

    function scrollable(el) {
        el.style.overflowY = 'auto';
        Object.defineProperty(el, 'scrollHeight', { value: 1000 });
        Object.defineProperty(el, 'clientHeight', { value: 200 });
    }

    it('returns null when nothing scrollable wraps the element (window scrolls)', () => {
        const leaf = document.createElement('span');
        document.body.appendChild(leaf);
        expect(findScrollContainer(leaf)).toBeNull();
    });

    it('returns the nearest overflow-y:auto ancestor with overflowing content', () => {
        const outer = document.createElement('div');
        const inner = document.createElement('div');
        const leaf = document.createElement('span');
        scrollable(outer);
        outer.appendChild(inner);
        inner.appendChild(leaf);
        document.body.appendChild(outer);
        expect(findScrollContainer(leaf)).toBe(outer);
    });

    it('skips overflow-y ancestors whose content does not overflow', () => {
        const outer = document.createElement('div');
        outer.style.overflowY = 'auto'; // scrollHeight === clientHeight (0)
        const leaf = document.createElement('span');
        outer.appendChild(leaf);
        document.body.appendChild(outer);
        expect(findScrollContainer(leaf)).toBeNull();
    });
});

describe('scrollSelectionClear', () => {
    afterEach(() => {
        document.body.textContent = '';
        vi.restoreAllMocks();
    });

    function mockRect(el, rect) {
        el.getBoundingClientRect = () => ({
            top: 0, bottom: 0, left: 0, right: 0, width: 0,
            height: (rect.bottom ?? 0) - (rect.top ?? 0), ...rect
        });
    }

    function setup({ selRect, paletteRect, toolbarRect }) {
        const selectedEl = document.createElement('span');
        const paletteEl = document.createElement('div');
        const stickyTopEl = document.createElement('div');
        document.body.append(selectedEl, paletteEl, stickyTopEl);
        mockRect(selectedEl, selRect);
        mockRect(paletteEl, paletteRect);
        mockRect(stickyTopEl, toolbarRect);
        return { selectedEl, paletteEl, stickyTopEl };
    }

    it('scrolls the window down when the palette occludes the selection', () => {
        window.innerHeight = 800;
        const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
        const els = setup({
            selRect: { top: 640, bottom: 660 },
            paletteRect: { top: 500, bottom: 800 },   // docked palette, picker open
            toolbarRect: { top: 0, bottom: 48 }
        });
        const delta = scrollSelectionClear(els);
        expect(delta).toBe(160 + SCROLL_GAP);
        expect(scrollBy).toHaveBeenCalledWith({ top: 160 + SCROLL_GAP, behavior: 'smooth' });
    });

    it('does not scroll when the selection is already clear of the palette', () => {
        window.innerHeight = 800;
        const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
        const els = setup({
            selRect: { top: 300, bottom: 320 },
            paletteRect: { top: 500, bottom: 800 },
            toolbarRect: { top: 0, bottom: 48 }
        });
        expect(scrollSelectionClear(els)).toBe(0);
        expect(scrollBy).not.toHaveBeenCalled();
    });

    it('scrolls up when the selection is hidden under the sticky toolbar', () => {
        window.innerHeight = 800;
        const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
        const els = setup({
            selRect: { top: 10, bottom: 30 },
            paletteRect: { top: 600, bottom: 800 },
            toolbarRect: { top: 0, bottom: 48 }
        });
        const delta = scrollSelectionClear(els);
        expect(delta).toBe(10 - 48 - SCROLL_GAP);
        expect(scrollBy).toHaveBeenCalledWith({ top: delta, behavior: 'smooth' });
    });

    it('ignores a hidden palette (zero-height rect)', () => {
        window.innerHeight = 800;
        const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
        const els = setup({
            selRect: { top: 640, bottom: 660 },
            paletteRect: { top: 0, bottom: 0 },       // display:none
            toolbarRect: { top: 0, bottom: 48 }
        });
        expect(scrollSelectionClear(els)).toBe(0);
        expect(scrollBy).not.toHaveBeenCalled();
    });

    it('uses instant scrolling when prefers-reduced-motion is set', () => {
        window.innerHeight = 800;
        const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
        window.matchMedia = vi.fn().mockReturnValue({ matches: true });
        const els = setup({
            selRect: { top: 640, bottom: 660 },
            paletteRect: { top: 500, bottom: 800 },
            toolbarRect: { top: 0, bottom: 48 }
        });
        scrollSelectionClear(els);
        expect(scrollBy).toHaveBeenCalledWith(
            expect.objectContaining({ behavior: 'auto' }));
        delete window.matchMedia;
    });

    it('scrolls a scrollable ancestor instead of the window when one exists', () => {
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        Object.defineProperty(scroller, 'scrollHeight', { value: 2000 });
        Object.defineProperty(scroller, 'clientHeight', { value: 400 });
        scroller.scrollBy = vi.fn();
        scroller.getBoundingClientRect = () => ({ top: 100, bottom: 500, height: 400 });
        const selectedEl = document.createElement('span');
        scroller.appendChild(selectedEl);
        document.body.appendChild(scroller);
        selectedEl.getBoundingClientRect = () => ({ top: 480, bottom: 495, height: 15 });
        const paletteEl = document.createElement('div');
        paletteEl.getBoundingClientRect = () => ({ top: 450, bottom: 500, height: 50 });
        const winScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});

        const delta = scrollSelectionClear({ selectedEl, paletteEl, stickyTopEl: null });
        expect(delta).toBe(45 + SCROLL_GAP);
        expect(scroller.scrollBy).toHaveBeenCalledWith({ top: delta, behavior: 'smooth' });
        expect(winScroll).not.toHaveBeenCalled();
    });

    it('is a no-op for a missing or detached element', () => {
        expect(scrollSelectionClear({ selectedEl: null, paletteEl: null, stickyTopEl: null })).toBe(0);
        const detached = document.createElement('span');
        expect(scrollSelectionClear({ selectedEl: detached, paletteEl: null, stickyTopEl: null })).toBe(0);
    });
});
