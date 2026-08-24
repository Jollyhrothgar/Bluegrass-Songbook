// The entry grid's ink must come from a token that actually exists.
//
// Regression: the grid asked for `--text-muted`, which is declared ONLY
// in create.html's inline block. In the in-app tab editor (reached from
// a work page, styled by css/style.css) the variable was undefined, so
// every grid line fell through to its near-black literal fallback and
// vanished against the dark theme. The staff's own `--tab-rule` token
// is declared in BOTH places, in both themes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { EditorState } from '../../otf-editor/state.js';
import { EditorCursor } from '../../otf-editor/cursor.js';

describe('entry grid ink', () => {
    let state;
    let cursor;
    let container;

    beforeEach(() => {
        state = new EditorState();
        state.getOrCreateMeasure(2);
        cursor = new EditorCursor(state);
        container = document.createElement('div');
        document.body.appendChild(container);
        cursor.init(container);
        cursor.setLayoutInfo({
            leftMargin: 40,
            topMargin: 30,
            stringSpacing: 16,
            measureWidth: 200,
            measuresPerRow: 2,
            ticksPerMeasure: 1920,
            rowHeight: 120,
            noteAreaStart: 10,
            noteAreaWidth: 180,
            trackInfoOffset: 0,
        });
        cursor.renderGrid();
    });

    afterEach(() => {
        cursor.destroy();
        container.remove();
    });

    function gridLines() {
        return Array.from(container.querySelectorAll('line'));
    }

    it('draws grid lines at all', () => {
        expect(gridLines().length).toBeGreaterThan(0);
    });

    it('strokes them from --tab-rule, never --text-muted', () => {
        for (const line of gridLines()) {
            const stroke = line.getAttribute('stroke');
            expect(stroke).toContain('--tab-rule');
            expect(stroke).not.toContain('--text-muted');
        }
    });

    it('has a theme-safe literal fallback (the token value, not near-black)', () => {
        for (const line of gridLines()) {
            expect(line.getAttribute('stroke')).toBe('var(--tab-rule, #8a8a8a)');
        }
    });

    it('separates beats from off-beats by opacity and width, not by colour', () => {
        const strokes = new Set(gridLines().map(l => l.getAttribute('stroke')));
        expect(strokes.size).toBe(1);
        const opacities = new Set(gridLines().map(l => l.getAttribute('stroke-opacity')));
        expect(opacities.size).toBe(2);
        for (const o of opacities) expect(Number(o)).toBeGreaterThan(0);
        const widths = new Set(gridLines().map(l => l.getAttribute('stroke-width')));
        expect(widths).toEqual(new Set(['1.5', '0.75']));
    });
});
