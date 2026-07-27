// Pure make-verse/chorus text transform (wrap-section.js): wrapping a
// textarea selection in {start_of_X}/{end_of_X}. The host UI (mini-bar in
// the ChordPro pane header) is exercised end-to-end; every text edge case
// lives here.
import { describe, it, expect } from 'vitest';
import { wrapSelectionAsSection } from '../visual-editor/wrap-section.js';
import { parseSong } from '../visual-editor/model.js';

const sel = (text, needle) => {
    const i = text.indexOf(needle);
    if (i === -1) throw new Error(`needle not found: ${needle}`);
    return [i, i + needle.length];
};

describe('basic wrapping', () => {
    it('wraps fully selected lines in start/end directives', () => {
        const t = 'first line here\nsecond line here\n';
        const res = wrapSelectionAsSection(t, ...sel(t, 'second line here'), 'chorus');
        expect(res.text).toBe(
            'first line here\n\n{start_of_chorus: Chorus}\nsecond line here\n{end_of_chorus}\n');
    });

    it('a partial-line selection extends to whole lines', () => {
        const t = 'alpha words\nbravo words\ncharlie words\n';
        // select from mid-"alpha" to mid-"bravo"
        const res = wrapSelectionAsSection(t, 2, t.indexOf('bravo') + 3, 'verse');
        expect(res.text).toBe(
            '{start_of_verse: Verse 1}\nalpha words\nbravo words\n{end_of_verse}\n\ncharlie words\n');
    });

    it('a selection ending exactly at a line start does not swallow that line', () => {
        const t = 'alpha words\nbravo words\n';
        // select "alpha words\n" — ends at the start of the bravo line
        const res = wrapSelectionAsSection(t, 0, 'alpha words\n'.length, 'verse');
        expect(res.text).toContain('{start_of_verse: Verse 1}\nalpha words\n{end_of_verse}');
        expect(res.text).toContain('\n\nbravo words\n');
    });

    it('returned selection spans the inserted block', () => {
        const t = 'one\ntwo\nthree\n';
        const res = wrapSelectionAsSection(t, ...sel(t, 'two'), 'bridge');
        expect(res.text.slice(res.selStart, res.selEnd)).toBe(
            '{start_of_bridge: Bridge}\ntwo\n{end_of_bridge}');
    });

    it('chords ride along untouched', () => {
        const t = '[G]hello [C]world\n';
        const res = wrapSelectionAsSection(t, 0, t.length, 'verse');
        expect(res.text).toContain('[G]hello [C]world');
        const doc = parseSong(res.text);
        expect(doc.sections[0].lines[0].chords.map(c => c.chord)).toEqual(['G', 'C']);
    });
});

describe('no-op cases', () => {
    it('empty (collapsed) selection is a no-op', () => {
        expect(wrapSelectionAsSection('hello world\n', 3, 3, 'verse')).toBeNull();
    });

    it('blank-only selection is a no-op', () => {
        const t = 'line one\n\n\nline two\n';
        const a = t.indexOf('\n\n') + 1;
        expect(wrapSelectionAsSection(t, a, a + 1, 'chorus')).toBeNull();
    });

    it('directive-only selection is a no-op', () => {
        const t = 'line\n{end_of_verse}\nrest\n';
        expect(wrapSelectionAsSection(t, ...sel(t, '{end_of_verse}'), 'verse')).toBeNull();
    });

    it('bad type is a no-op', () => {
        expect(wrapSelectionAsSection('hello\n', 0, 5, '')).toBeNull();
        expect(wrapSelectionAsSection('hello\n', 0, 5, 'x y')).toBeNull();
    });
});

describe('blank-line trimming', () => {
    it('edge blanks stay outside the new section; interior blanks survive', () => {
        const t = 'intro\n\n\nline a\n\nline b\n\n\nafter\n';
        const start = t.indexOf('\n\n\nline a') + 1;   // include leading blanks
        const end = t.indexOf('\n\n\nafter') + 2;      // and trailing blanks
        const res = wrapSelectionAsSection(t, start, end, 'verse');
        // "intro" is an implicit verse above the selection, hence Verse 2
        expect(res.text).toBe(
            'intro\n\n{start_of_verse: Verse 2}\nline a\n\nline b\n{end_of_verse}\n\nafter\n');
    });

    it('wrapping the last lines keeps a single trailing newline', () => {
        const t = 'one\n\nlast line\n';
        const res = wrapSelectionAsSection(t, ...sel(t, 'last line'), 'chorus');
        expect(res.text.endsWith('{end_of_chorus}\n')).toBe(true);
        expect(res.text).not.toMatch(/\n\n$/);
    });

    it('wrapping the very first lines produces no leading blank lines', () => {
        const t = 'first\nsecond\n\nrest\n';
        const res = wrapSelectionAsSection(t, 0, t.indexOf('second') + 3, 'verse');
        expect(res.text.startsWith('{start_of_verse: Verse 1}\nfirst\nsecond\n{end_of_verse}')).toBe(true);
    });
});

describe('selections spanning existing sections', () => {
    const TWO = '{start_of_verse: Verse 1}\nline a\n{end_of_verse}\n\n' +
        '{start_of_chorus: Chorus}\nline b\n{end_of_chorus}\n';

    it('strips the old directives and emits one clean section', () => {
        const res = wrapSelectionAsSection(TWO, 0, TWO.length, 'verse');
        expect(res.text).toBe(
            '{start_of_verse: Verse 1}\nline a\n\nline b\n{end_of_verse}\n');
        expect(parseSong(res.text).sections).toHaveLength(1);
    });

    it('short-form directives ({soc}/{eoc}) are stripped too', () => {
        const t = '{soc}\nglory glory\n{eoc}\n';
        const res = wrapSelectionAsSection(t, 0, t.length, 'verse');
        expect(res.text).toBe('{start_of_verse: Verse 1}\nglory glory\n{end_of_verse}\n');
    });

    it('wrapping lines out of the middle of a section leaves a sane document', () => {
        const t = '{start_of_verse: Verse 1}\nline a\nline b\n{end_of_verse}\n';
        const res = wrapSelectionAsSection(t, ...sel(t, 'line b'), 'chorus');
        // parse → serialize round-trips to verse + chorus, nothing dropped
        const doc = parseSong(res.text);
        const types = doc.sections.map(s => s.type);
        expect(types).toContain('verse');
        expect(types).toContain('chorus');
        const all = doc.sections.flatMap(s => s.lines.map(l => l.lyrics));
        expect(all).toContain('line a');
        expect(all).toContain('line b');
    });
});

describe('label auto-numbering (positional: sections of the type above)', () => {
    it('first verse is Verse 1, next is Verse 2 (implicit sections count)', () => {
        const t1 = 'lonely line\n';
        expect(wrapSelectionAsSection(t1, 0, t1.length, 'verse').text)
            .toContain('{start_of_verse: Verse 1}');

        const t2 = '{start_of_verse: Verse 1}\nold\n{end_of_verse}\n\nnew line here\n';
        expect(wrapSelectionAsSection(t2, ...sel(t2, 'new line here'), 'verse').text)
            .toContain('{start_of_verse: Verse 2}');

        // an implicit (undirectived) verse elsewhere also bumps the number
        const t3 = 'implicit verse line\n\nnew line here\n';
        expect(wrapSelectionAsSection(t3, ...sel(t3, 'new line here'), 'verse').text)
            .toContain('{start_of_verse: Verse 2}');
    });

    it('first chorus is bare Chorus; the second is Chorus 2', () => {
        const t1 = 'glory glory\n';
        expect(wrapSelectionAsSection(t1, 0, t1.length, 'chorus').text)
            .toContain('{start_of_chorus: Chorus}');

        const t2 = '{start_of_chorus: Chorus}\nold\n{end_of_chorus}\n\nnew chorus line\n';
        expect(wrapSelectionAsSection(t2, ...sel(t2, 'new chorus line'), 'chorus').text)
            .toContain('{start_of_chorus: Chorus 2}');
    });

    it('re-wrapping a section does not count the stripped directives', () => {
        // the selected verse is removed from the count, so it stays Verse 1
        const t = '{start_of_verse: Verse 1}\nonly verse\n{end_of_verse}\n';
        const res = wrapSelectionAsSection(t, 0, t.length, 'verse');
        expect(res.text).toContain('{start_of_verse: Verse 1}');
        expect(res.text).not.toContain('Verse 2');
    });
});

describe('metadata stays put', () => {
    it('wrapping lyric lines below a metadata block leaves it untouched', () => {
        const t = '{meta: title Keep Me}\n{key: G}\n\nhello world friend\n';
        const res = wrapSelectionAsSection(t, ...sel(t, 'hello world friend'), 'verse');
        expect(res.text.startsWith('{meta: title Keep Me}\n{key: G}\n\n{start_of_verse')).toBe(true);
        const doc = parseSong(res.text);
        expect(doc.metadata.fields.title).toBe('Keep Me');
    });
});
