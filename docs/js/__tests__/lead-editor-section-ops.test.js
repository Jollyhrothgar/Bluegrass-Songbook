// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
    markSelection, renameSection, setSectionTypeText, duplicateSectionText, moveSectionText,
    unlabelSection, deleteSectionText, diffChange,
} from '../lead-editor/section-ops.js';
import { analyzeDocument } from '../lead-editor/doc-model.js';

const DOC = [
    '{start_of_verse: Verse 1}', 'One', '{end_of_verse}', '',
    '{start_of_chorus: Chorus}', 'Two', '{end_of_chorus}',
].join('\n');

describe('marking a selection as a section', () => {
    const text = 'Line one\nLine two\n\nLine three';
    it('wraps the lines a selection touches, even a partial one', () => {
        const res = markSelection(text, 3, 12, 'verse');   // mid line one to mid line two
        expect(res.text).toBe('{start_of_verse: Verse 1}\nLine one\nLine two\n{end_of_verse}\n\nLine three');
    });
    it('auto-numbers and types', () => {
        const first = markSelection(text, 0, 8, 'chorus').text;
        expect(first).toContain('{start_of_chorus: Chorus}');
        const second = markSelection(first, first.indexOf('Line three'), first.length, 'chorus').text;
        expect(second).toContain('{start_of_chorus: Chorus 2}');
    });
    it('an empty selection is a no-op', () => {
        expect(markSelection(text, 4, 4, 'verse')).toBe(null);
    });
});

describe('label menu operations', () => {
    it('renames', () => {
        expect(renameSection(DOC, 0, 'First')).toContain('{start_of_verse: First}');
        expect(renameSection(DOC, 0, '  ')).toBe(null);
    });
    it('changes type, relabels and fixes the end directive', () => {
        const out = setSectionTypeText(DOC, 0, 'bridge');
        expect(out).toContain('{start_of_bridge: Bridge}');
        expect(out).toContain('{end_of_bridge}');
        expect(out).not.toContain('end_of_verse');
    });
    it('turns an implicit verse into a real section', () => {
        const out = setSectionTypeText('Just words', 0, 'chorus');
        expect(out).toBe('{start_of_chorus: Chorus}\nJust words\n{end_of_chorus}\n');
    });
    it('duplicates a section after itself', () => {
        const out = duplicateSectionText(DOC, 0);
        expect(analyzeDocument(out).sections.map((s) => s.type)).toEqual(['verse', 'verse', 'chorus']);
    });
    it('moves a section down and up', () => {
        const down = moveSectionText(DOC, 0, 1);
        expect(analyzeDocument(down).sections.map((s) => s.type)).toEqual(['chorus', 'verse']);
        expect(moveSectionText(DOC, 0, -1)).toBe(null);
        const up = moveSectionText(down, down.split('\n').findIndex((l) => l.startsWith('{start_of_verse')), -1);
        expect(analyzeDocument(up).sections.map((s) => s.type)).toEqual(['verse', 'chorus']);
    });
    it('removes the label but keeps the lyrics', () => {
        const out = unlabelSection(DOC, 0);
        expect(out.split('\n')[0]).toBe('One');
        expect(out).not.toContain('end_of_verse');
        expect(out).toContain('{start_of_chorus');
    });
    it('deletes a section and its blank separator', () => {
        const out = deleteSectionText(DOC, 0);
        expect(out).toBe('{start_of_chorus: Chorus}\nTwo\n{end_of_chorus}');
    });
});

describe('diffChange', () => {
    it('is the smallest single replacement', () => {
        expect(diffChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' });
        expect(diffChange('same', 'same')).toEqual({ from: 4, to: 4, insert: '' });
    });
});
