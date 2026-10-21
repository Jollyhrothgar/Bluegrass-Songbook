// The editor's automation handle (otf-editor/automation.js): the pure
// layout rules on hand-built layouts, and the handle driving a real
// editor in jsdom. Layout MEASURING needs a browser — that half is
// e2e/otf-editor-invariants.spec.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { layoutViolations, keyEventInit } from '../../otf-editor/automation.js';
import { eventToKeyString } from '../../otf-editor/bindings.js';
import { OTFEditor } from '../../otf-editor/editor.js';

// Two 4/4 bars, 300px each, eighth-note ruler (8 lines, 30px apart,
// starting 30px in) — a layout that breaks no rule.
function sane() {
    const ruler = [];
    for (const [measure, left] of [[1, 100], [2, 400]]) {
        for (let i = 0; i < 8; i++) ruler.push({ measure, tick: i * 240, x: left + 30 + i * 30 });
    }
    return {
        measures: [
            { measure: 1, row: 0, ticks: 1920, left: 100, right: 400 },
            { measure: 2, row: 0, ticks: 1920, left: 400, right: 700 },
        ],
        ruler,
        notes: [{ measure: 1, tick: 240, string: 3, x: 160 }],
        rests: [{ measure: 1, left: 200, right: 212 }],
        cursor: { measure: 2, tick: 0, string: 3, x: 430 },
    };
}

const rules = (layout) => layoutViolations(layout).map(v => v.rule);

describe('layoutViolations', () => {
    it('a sane layout breaks nothing', () => {
        expect(layoutViolations(sane())).toEqual([]);
    });

    it('flags a ruler that starts mid-bar and runs past the barline', () => {
        // what centering did to an empty measure: tick 0 at the middle
        const l = sane();
        l.ruler = l.ruler.map(r => (r.measure === 2 ? { ...r, x: r.x + 120 } : r));
        l.cursor = null;
        expect(rules(l)).toContain('ruler-inside-measure');
    });

    it('flags an uneven ruler', () => {
        const l = sane();
        l.ruler[5] = { ...l.ruler[5], x: l.ruler[5].x + 6 };
        expect(rules(l)).toContain('ruler-periodic');
    });

    it('flags a note off its ruler line and a cursor off its tick', () => {
        const l = sane();
        l.notes[0].x += 8;
        l.cursor.x += 8;
        expect(rules(l)).toEqual(expect.arrayContaining(['note-on-ruler', 'cursor-on-ruler']));
    });

    it('flags a rest drawn in the next measure', () => {
        const l = sane();
        l.rests.push({ measure: 1, left: 410, right: 422 });
        expect(rules(l)).toContain('rest-inside-measure');
    });

    it('flags a note or cursor outside its bar', () => {
        const l = sane();
        l.notes.push({ measure: 1, tick: 2000, string: 1, x: 420 });
        l.cursor.x = 720;
        expect(rules(l)).toEqual(expect.arrayContaining(['note-inside-measure', 'cursor-inside-measure']));
    });
});

describe('keyEventInit speaks the matcher\'s grammar', () => {
    it.each([
        ['5', '5'],
        ['ArrowRight', 'ArrowRight'],
        ['Ctrl+z', 'Ctrl+z'],
        ['Shift+ArrowLeft', 'Shift+ArrowLeft'],
        ['Alt+g', 'Alt+g'],
        ['Space', 'Space'],
    ])('%s round-trips through eventToKeyString', (chord, expected) => {
        expect(eventToKeyString(keyEventInit(chord))).toBe(expected);
    });
});

describe('editor.automation', () => {
    let container;
    let editor;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        editor = new OTFEditor({ container });
    });

    afterEach(() => {
        editor?.destroy();
        container.remove();
    });

    it('is reachable from the element handle', () => {
        const el = container.querySelector('.otf-editor');
        expect(el.__otfEditor.automation).toBe(editor.automation);
    });

    it('press() types through the real key handler, exec() runs an action', () => {
        const auto = editor.automation;
        auto.setCursor({ measure: 1, tick: 0, string: 3 });
        auto.press('5');
        const m1 = auto.doc().notation.banjo.find(m => m.measure === 1);
        expect(m1.events[0].notes[0]).toMatchObject({ s: 3, f: 5 });

        expect(auto.actions()).toContain('edit.undo');
        auto.exec('edit.undo');
        const after = auto.doc().notation.banjo.find(m => m.measure === 1);
        expect(after?.events ?? []).toHaveLength(0);
    });

    it('cursor() reports the position setCursor() put it at', () => {
        editor.automation.setCursor({ measure: 2, tick: 480, string: 1 });
        expect(editor.automation.cursor()).toMatchObject({ measure: 2, tick: 480, string: 1 });
    });

    it('doc() is a copy — mutating it cannot reach around the facade', () => {
        const d = editor.automation.doc();
        d.metadata.title = 'hijacked';
        expect(editor.automation.doc().metadata.title).not.toBe('hijacked');
    });

    it('throws once the editor is destroyed', () => {
        const auto = editor.automation;
        editor.destroy();
        editor = null;
        expect(() => auto.doc()).toThrow(/destroyed/);
    });
});
