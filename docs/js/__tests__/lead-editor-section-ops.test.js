// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
    markSelection, renameSection, setSectionTypeText, duplicateSectionText, moveSectionText,
    unlabelSection, deleteSectionText, diffChange, sectionsForClipboard, placeSectionPaste,
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

// Copy / cut / paste of whole sections in Lyrics mode (Mike, 2026-10-27: "when
// I copy / paste a section, it gets copied as a verse - even if it's a
// chorus"). The section markers are hidden widgets there, so a selection of
// the lyrics never held them and the browser's copy dropped the type.
describe('what a copy puts on the clipboard', () => {
    const SONG = [
        '{start_of_verse: Verse 1}', 'One two', 'Three four', '{end_of_verse}', '',
        '{start_of_chorus: Chorus}', '[G]Sing it loud', 'Sing it [D]proud', '{end_of_chorus}', '',
        'Plain line', 'Another plain',
    ].join('\n');
    const at = (s, t = SONG) => t.indexOf(s);
    const end = (s, t = SONG) => t.indexOf(s) + s.length;

    it('a whole chorus comes with its markers, so it pastes back as a chorus', () => {
        const clip = sectionsForClipboard(SONG, at('[G]Sing'), end('Sing it [D]proud'));
        expect(clip.text).toBe('{start_of_chorus: Chorus}\n[G]Sing it loud\nSing it [D]proud\n{end_of_chorus}');
        // a cut takes the label and the end line with it
        expect(SONG.slice(clip.from, clip.to)).toBe('{start_of_chorus: Chorus}\n[G]Sing it loud\nSing it [D]proud\n{end_of_chorus}');
    });

    it('a drag that starts after a line-leading chord still copies the whole section, chord and all', () => {
        const clip = sectionsForClipboard(SONG, at('Sing it loud'), end('Sing it [D]proud'));
        expect(clip.text).toBe('{start_of_chorus: Chorus}\n[G]Sing it loud\nSing it [D]proud\n{end_of_chorus}');
    });

    it('a selection ending at the start of the next line (a triple click) is the line before', () => {
        const clip = sectionsForClipboard(SONG, at('One two'), at('{end_of_verse}'));
        expect(clip.text).toBe('{start_of_verse: Verse 1}\nOne two\nThree four\n{end_of_verse}');
    });

    it('lines from inside one section stay plain text: repeating a line must not make a new section', () => {
        expect(sectionsForClipboard(SONG, at('One two'), end('One two'))).toBeNull();
        expect(sectionsForClipboard(SONG, at('two'), at('four'))).toBeNull();
        expect(sectionsForClipboard(SONG, at('Plain line'), end('Another plain'))).toBeNull();
    });

    it('across a boundary every piece keeps its own section, balanced', () => {
        const clip = sectionsForClipboard(SONG, at('Three four'), end('Sing it [D]proud'));
        expect(clip.text).toBe([
            '{start_of_verse: Verse 1}', 'Three four', '{end_of_verse}', '',
            '{start_of_chorus: Chorus}', '[G]Sing it loud', 'Sing it [D]proud', '{end_of_chorus}',
        ].join('\n'));
        // a cut leaves the verse's label (only part of it went) and takes the whole chorus
        expect(clip.from).toBe(at('Three four'));
        expect(clip.to).toBe(end('{end_of_chorus}'));
    });

    it('a chorus and the plain lines after it: the chorus marked, the rest as it was', () => {
        const clip = sectionsForClipboard(SONG, at('[G]Sing'), end('Plain line'));
        expect(clip.text).toBe('{start_of_chorus: Chorus}\n[G]Sing it loud\nSing it [D]proud\n{end_of_chorus}\n\nPlain line');
    });

    it('select all copies the song exactly as it is', () => {
        expect(sectionsForClipboard(SONG, 0, SONG.length).text).toBe(SONG);
    });

    it('a section closed by the next one (no end marker) gets one on the clipboard', () => {
        const text = '{start_of_chorus}\nA line\n{start_of_verse}\nB line';
        const clip = sectionsForClipboard(text, at('A line', text), end('A line', text));
        expect(clip.text).toBe('{start_of_chorus}\nA line\n{end_of_chorus}');
    });

    it('nothing selected is not a section copy', () => {
        expect(sectionsForClipboard(SONG, at('One'), at('One'))).toBeNull();
    });
});

describe('where pasted sections land', () => {
    const SONG = [
        '{start_of_verse: Verse 1}', 'One two', '{end_of_verse}', '',
        '{start_of_chorus: Chorus}', 'Sing it', '{end_of_chorus}',
    ].join('\n');
    const CLIP = '{start_of_chorus: Chorus}\nSing it\n{end_of_chorus}';
    const paste = (text, pos, insert = CLIP) => {
        const p = placeSectionPaste(text, pos, insert);
        return p && text.slice(0, p.from) + p.insert + text.slice(p.to);
    };

    it('plain text is not its business', () => {
        expect(placeSectionPaste(SONG, 3, 'just words')).toBeNull();
    });

    it('a caret inside a section: after that section, never nested in it', () => {
        expect(paste(SONG, SONG.indexOf('two'))).toBe([
            '{start_of_verse: Verse 1}', 'One two', '{end_of_verse}', '',
            CLIP, '',
            '{start_of_chorus: Chorus}', 'Sing it', '{end_of_chorus}',
        ].join('\n'));
    });

    it('a caret on the blank line between sections: right there, a blank line either side', () => {
        const blank = SONG.indexOf('{end_of_verse}') + '{end_of_verse}\n'.length;
        expect(paste(SONG, blank)).toBe(paste(SONG, SONG.indexOf('two')));
    });

    it('at the end of the song: after a blank line, ending in a newline', () => {
        expect(paste(SONG, SONG.length)).toBe(`${SONG}\n\n${CLIP}\n`);
    });

    it('a caret in plain (untagged) lines: after that paragraph', () => {
        const text = 'Plain one\nPlain two\n\nPlain three';
        expect(paste(text, text.indexOf('one'))).toBe(`Plain one\nPlain two\n\n${CLIP}\n\nPlain three`);
    });

    it('an empty sheet: just the sections', () => {
        expect(paste('', 0)).toBe(`${CLIP}\n`);
    });

    it('trims the newlines the clipboard brought, so blank lines never pile up', () => {
        expect(paste(SONG, SONG.length, `\n\n${CLIP}\n\n`)).toBe(`${SONG}\n\n${CLIP}\n`);
    });
});
