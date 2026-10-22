// Horizontal zoom (fix-it A21): the editor's "how much room does a tick
// get" control, separate from the cursor step and from the Aa size.
//
// Mike, 2026-10-21: "we need a way to zoom in and out ... the more useful
// zoom is basically horizontal scaling". At 1/32 on a desktop a slot was
// 4.7px — narrower than a fret digit — so the ruler hid every other line,
// the cursor parked on lines nobody could see, and 32nds typed by aiming
// at the visible lines landed a 16th apart. The cursor step must not
// widen measures (A20: that shrank the whole tab), so the room has to
// come from somewhere the reader chooses: this.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { OTFEditor } from '../../otf-editor/editor.js';
import { EditorState, DURATIONS, H_ZOOM_LEVELS } from '../../otf-editor/state.js';
import { gridLinesForRow, MIN_RULER_SPACING_PX } from '../../otf-editor/cursor.js';

const itemsOf = (bar) => [...bar.popup.querySelectorAll('.menu-item')];
const labelOf = (el) => el.querySelector('.menu-item-label').textContent;
const findItem = (bar, text) => itemsOf(bar)
    .find(el => labelOf(el) === text || labelOf(el) === `✓ ${text}`);

/** Ruler lines of row 0 at the editor's current layout (SVG units = px in jsdom). */
function rulerRow0(editor, step) {
    const row = editor.renderer.rowData[0];
    return gridLinesForRow(row.measures, step, () => 480,
        { pxPerUnit: 1, minSpacing: MIN_RULER_SPACING_PX });
}

describe('EditorState horizontal zoom', () => {
    it('starts at 1 and steps through the levels, clamped at both ends', () => {
        const s = new EditorState();
        expect(s.horizontalZoom).toBe(1);
        const seen = [];
        s.on('horizontalZoomChange', z => seen.push(z));

        s.zoomHorizontally(1);
        expect(s.horizontalZoom).toBe(H_ZOOM_LEVELS[H_ZOOM_LEVELS.indexOf(1) + 1]);
        for (let i = 0; i < 20; i++) s.zoomHorizontally(1);
        expect(s.horizontalZoom).toBe(H_ZOOM_LEVELS.at(-1));
        for (let i = 0; i < 20; i++) s.zoomHorizontally(-1);
        expect(s.horizontalZoom).toBe(H_ZOOM_LEVELS[0]);
        s.setHorizontalZoom(1);
        expect(s.horizontalZoom).toBe(1);
        expect(seen.at(-1)).toBe(1);
    });

    it('a no-op step emits nothing', () => {
        const s = new EditorState();
        s.setHorizontalZoom(H_ZOOM_LEVELS.at(-1));
        const seen = [];
        s.on('horizontalZoomChange', z => seen.push(z));
        s.zoomHorizontally(1);
        expect(seen).toEqual([]);
    });

    it('is not the cursor step, and the cursor step is not it', () => {
        const s = new EditorState();
        s.setGridSubdivision(DURATIONS.thirtySecond);
        expect(s.horizontalZoom).toBe(1);
        s.zoomHorizontally(1);
        expect(s.gridSubdivision).toBe(DURATIONS.thirtySecond);
    });
});

describe('editor horizontal zoom', () => {
    let container;
    let editor;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        editor = new OTFEditor({ container });
        editor.state.getOrCreateMeasure(8);
        editor._render();
    });

    afterEach(() => {
        editor.destroy();
        container.remove();
    });

    it('zoom 1 is exactly the pinned layout (no floor, read-view rows)', () => {
        expect(editor.renderer.options.measuresPerRow).toBe(4);
        expect(editor.renderer.options.measureWidthFloor).toBe(0);
    });

    it('zooming in widens every measure and moves bars to new rows', () => {
        const w1 = editor.renderer._computedMeasureWidth;
        const rows1 = editor.renderer.rowData.length;

        editor.state.setHorizontalZoom(2);
        const w2 = editor.renderer._computedMeasureWidth;
        expect(w2).toBeGreaterThanOrEqual(2 * w1 - 1);
        expect(editor.renderer.options.measuresPerRow).toBe(2);
        expect(editor.renderer.rowData.length).toBeGreaterThan(rows1);
        // every measure on a row gets the same width
        for (const m of editor.renderer.rowData[0].measures) {
            expect(m.width).toBeGreaterThanOrEqual(w2 - 1);
        }
    });

    it('zooming out packs more bars per row', () => {
        editor.state.setHorizontalZoom(H_ZOOM_LEVELS[0]);
        expect(editor.renderer.options.measuresPerRow).toBeGreaterThan(4);
    });

    it('at 1/32 the ruler hides lines at zoom 1 and shows every one zoomed in', () => {
        // The bug in one assertion: the step the cursor uses vs the lines drawn
        const thirtySecond = DURATIONS.thirtySecond;
        expect(rulerRow0(editor, thirtySecond).some(l => l.hidden)).toBe(true);

        editor.state.setHorizontalZoom(H_ZOOM_LEVELS.at(-1));
        expect(rulerRow0(editor, thirtySecond).some(l => l.hidden)).toBe(false);
    });

    it('one measure wider than the row is kept at size (it scrolls, never shrinks)', () => {
        editor.state.setHorizontalZoom(H_ZOOM_LEVELS.at(-1));
        expect(editor.renderer.options.measuresPerRow).toBe(1);
        const layoutWidth = editor.renderer._availableWidth();
        expect(editor.renderer._computedMeasureWidth).toBeGreaterThan(layoutWidth);
    });

    it('never touches the document or the entry state', () => {
        editor.automation.setCursor({ measure: 1, tick: 0, string: 3 });
        editor.automation.press('5');
        const before = JSON.stringify(editor.state.otf);
        const grid = editor.state.gridSubdivision;
        const dur = editor.state.currentDuration;
        const undo = editor.state.history.canUndo();

        editor.state.zoomHorizontally(1);
        editor.state.zoomHorizontally(1);
        expect(JSON.stringify(editor.state.otf)).toBe(before);
        expect(editor.state.gridSubdivision).toBe(grid);
        expect(editor.state.currentDuration).toBe(dur);
        expect(editor.state.history.canUndo()).toBe(undo);
    });

    it('is not the Aa size: the renderer scale stays put', () => {
        editor.state.setHorizontalZoom(2);
        expect(editor.renderer._scale || 1).toBe(1);
    });

    it('View ▸ Zoom in / out / Reset drive the horizontal zoom', () => {
        editor.menuBar.open('view');
        findItem(editor.menuBar, 'Zoom in').click();
        expect(editor.state.horizontalZoom).toBeGreaterThan(1);
        editor.menuBar.open('view');
        findItem(editor.menuBar, 'Reset zoom').click();
        expect(editor.state.horizontalZoom).toBe(1);
        editor.menuBar.open('view');
        findItem(editor.menuBar, 'Zoom out').click();
        expect(editor.state.horizontalZoom).toBeLessThan(1);
        expect(editor.renderer._scale || 1).toBe(1);
    });

    it('} and { zoom in and out from the keyboard', () => {
        editor.automation.press('}');
        expect(editor.state.horizontalZoom).toBeGreaterThan(1);
        editor.automation.press('{');
        editor.automation.press('{');
        expect(editor.state.horizontalZoom).toBeLessThan(1);
    });

    it('View ▸ Measures per row sets the zoom-1 layout and resets the zoom', () => {
        editor.state.setHorizontalZoom(2);
        editor.menuBar.open('view');
        findItem(editor.menuBar, '3').click();
        expect(editor.state.horizontalZoom).toBe(1);
        expect(editor.renderer.options.measuresPerRow).toBe(3);
        editor.menuBar.open('view');
        expect(labelOf(findItem(editor.menuBar, '3'))).toBe('✓ 3');
    });

    it('the status bar shows the zoom and its buttons step it', () => {
        const label = container.querySelector('.editor-status-bar .zoom-section .zoom-level');
        expect(label.textContent).toBe('100%');
        container.querySelector('.zoom-section .zoom-in-button').click();
        expect(editor.state.horizontalZoom).toBeGreaterThan(1);
        expect(label.textContent).toBe(`${Math.round(editor.state.horizontalZoom * 100)}%`);
        container.querySelector('.zoom-section .zoom-out-button').click();
        expect(label.textContent).toBe('100%');
    });

    it('the zoom buttons say their keys, and stop at the ends', () => {
        const zin = container.querySelector('.zoom-in-button');
        const zout = container.querySelector('.zoom-out-button');
        expect(zin.title).toContain('}');
        expect(zout.title).toContain('{');
        editor.state.setHorizontalZoom(H_ZOOM_LEVELS.at(-1));
        expect(zin.disabled).toBe(true);
        editor.state.setHorizontalZoom(H_ZOOM_LEVELS[0]);
        expect(zout.disabled).toBe(true);
        expect(zin.disabled).toBe(false);
    });

    it('points at zoom while the ruler is thinning the cursor step', () => {
        const group = container.querySelector('.status-zoom');
        const overlay = container.querySelector('.editor-grid-overlay')
            || container.querySelector('.editor-canvas-container');
        // jsdom draws no ruler (no layout box), so stand in for a thinned line
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.dataset.hidden = '';
        svg.appendChild(line);
        const host = document.createElement('div');
        host.className = 'editor-grid-overlay';
        host.appendChild(svg);
        overlay.appendChild(host);
        editor._updateZoomControls();
        expect(group.classList.contains('needs-zoom')).toBe(true);
        expect(group.title).toMatch(/every other line/);
        host.remove();
        editor._updateZoomControls();
        expect(group.classList.contains('needs-zoom')).toBe(false);
    });

    it('automation.layout() reports the horizontal zoom', () => {
        editor.state.setHorizontalZoom(2);
        expect(editor.automation.layout().hZoom).toBe(2);
    });
});

describe('a click closes the two-digit fret window', () => {
    let container;
    let editor;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        editor = new OTFEditor({ container });
    });

    afterEach(() => {
        editor.destroy();
        container.remove();
    });

    it('2, click elsewhere, 0 gives two notes — not fret 20', () => {
        editor.automation.setCursor({ measure: 1, tick: 0, string: 3 });
        editor.automation.press('2');
        // jsdom has no layout box, so stand in for the hit test
        editor._positionFromPoint = () => ({ measure: 1, tick: 960, string: 2 });
        expect(editor._setCursorFromPoint(0, 0)).toBe(true);
        editor.automation.press('0');

        const events = editor.automation.doc().notation.banjo
            .find(m => m.measure === 1).events;
        const notes = events.flatMap(e => e.notes.map(n => ({ tick: e.tick, s: n.s, f: n.f })));
        expect(notes).toEqual(expect.arrayContaining([
            { tick: 0, s: 3, f: 2 },
            { tick: 960, s: 2, f: 0 },
        ]));
        expect(notes.some(n => n.f === 20)).toBe(false);
    });
});
