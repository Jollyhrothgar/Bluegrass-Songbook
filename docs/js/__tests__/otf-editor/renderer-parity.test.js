// The editor draws the SAME document the reader sees.
//
// Plan docs/plans/tab-editor-input-parity.md §8.1/§9.2: pressing Edit
// used to re-space every measure (`centerNotes: false`) and sprinkle rest
// glyphs (`showRests: true`, already the renderer default), so "the page
// you edit is the page you publish" was false. The only things the editor
// still changes are ENTRY affordances, not document shape: thicker stems
// (§7 "thicker stems desires") and a pinned row count (§7 "horizontal
// shifting / column mutation makes it non-deterministic where measures
// run").
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { OTFEditor } from '../../otf-editor/editor.js';
import { TabRenderer } from '../../renderers/tablature.js';
import { DURATIONS } from '../../otf-editor/state.js';

describe('editor renderer options', () => {
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

    it('does not override centerNotes — the reader\'s spacing survives', () => {
        const readDefault = new TabRenderer(document.createElement('div'));
        expect(editor.renderer.options.centerNotes).toBe(readDefault.options.centerNotes);
        expect(editor.renderer.options.centerNotes).not.toBe(false);
    });

    it('does not override showRests either (it was already the default)', () => {
        const readDefault = new TabRenderer(document.createElement('div'));
        expect(editor.renderer.options.showRests).toBe(readDefault.options.showRests);
    });

    it('draws thicker stems and beams than the read view', () => {
        const readDefault = new TabRenderer(document.createElement('div'));
        expect(editor.renderer.options.stemWidth).toBe(2.5);
        expect(editor.renderer.options.beamThickness).toBe(4);
        // the site's read view is untouched
        expect(readDefault.options.stemWidth).toBe(1.5);
        expect(readDefault.options.beamThickness).toBe(3);
    });

    it('keeps the uniform measure slots the read view uses', () => {
        expect(editor.renderer.options.uniformMeasureWidth).not.toBe(false);
    });
});

describe('editor row layout is deterministic', () => {
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

    it('pins measures per row to the read view\'s number', () => {
        // jsdom has no layout box, so the renderer falls back to its
        // 800px nominal width -> the read view's auto value, 4.
        const readDefault = new TabRenderer(document.createElement('div'));
        expect(editor.renderer.options.measuresPerRow)
            .toBe(readDefault.autoMeasuresPerRow());
        expect(editor.renderer.options.measuresPerRow).toBe(4);
    });

    it('a finer entry grid widens measures instead of reflowing rows', () => {
        editor.state.getOrCreateMeasure(8);
        editor.state.setGridSubdivision(DURATIONS.quarter);
        const rowsBefore = editor.renderer.rowData.length;
        expect(rowsBefore).toBe(2);              // 8 measures, 4 per row
        const perRowBefore = editor.renderer.options.measuresPerRow;
        const widthBefore = editor.renderer._computedMeasureWidth;

        editor.state.setGridSubdivision(DURATIONS.thirtySecond);

        expect(editor.renderer.options.measuresPerRow).toBe(perRowBefore);
        expect(editor.renderer.rowData.length).toBe(rowsBefore);
        expect(editor.renderer._computedMeasureWidth).toBeGreaterThan(widthBefore);
    });

    it('honours an explicit measuresPerRow option', () => {
        const c2 = document.createElement('div');
        document.body.appendChild(c2);
        const ed2 = new OTFEditor({ container: c2, measuresPerRow: 6 });
        expect(ed2.renderer.options.measuresPerRow).toBe(6);
        ed2.destroy();
        c2.remove();
    });
});
