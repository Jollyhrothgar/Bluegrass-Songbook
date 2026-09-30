// A4: parseChordPro must never drop a lyric line, whatever tags surround it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    parseChordPro,
    renderSectionsHtml,
    renderSectionsAscii,
    renderSectionsPrintHtml
} from '../renderers/chordpro.js';

describe('parseChordPro: untagged lines', () => {
    it('turns untagged text into implicit verses split on blank lines', () => {
        const { sections } = parseChordPro('[G]One\nTwo\n\n[C]Three\n\n\nFour');
        expect(sections.map(s => [s.type, s.label, s.lines])).toEqual([
            ['verse', 'Verse 1', ['[G]One', 'Two']],
            ['verse', 'Verse 2', ['[C]Three']],
            ['verse', 'Verse 3', ['Four']],
        ]);
    });

    it('numbers implicit verses after explicit ones, like the editor', () => {
        const { sections } = parseChordPro('{start_of_verse: Verse 1}\nA\n{end_of_verse}\n\nB');
        expect(sections[1].label).toBe('Verse 2');
    });

    it('renders every lyric line of an untagged song', () => {
        const { sections } = parseChordPro('Baby [G]shark\nBaby [C]shark\n\nMommy [G]shark');
        const html = renderSectionsHtml(sections, { key: 'G' });
        expect(html).toContain('Mommy');
        expect(html.match(/class="song-line/g)).toHaveLength(3);
    });
});

describe('parseChordPro: section directives', () => {
    it('opens any start_of_X with a capitalised default label', () => {
        const { sections } = parseChordPro('{start_of_intro}\n[G]Da\n{end_of_intro}\n{start_of_outro: Fade}\n[C]Bye\n{end_of_outro}');
        expect(sections.map(s => [s.type, s.label])).toEqual([['intro', 'Intro'], ['outro', 'Fade']]);
        expect(sections[0].lines).toEqual(['[G]Da']);
    });

    it('supports the sov/soc/sob shorthands', () => {
        const { sections } = parseChordPro('{sov}\nA\n{eov}\n{soc: Hook}\nB\n{eoc}\n{sob}\nC\n{eob}');
        expect(sections.map(s => [s.type, s.label])).toEqual([
            ['verse', 'Verse'], ['chorus', 'Hook'], ['bridge', 'Bridge']]);
    });

    it('text after an end directive is an implicit verse, not dropped', () => {
        const { sections } = parseChordPro('{start_of_chorus}\nA\n{end_of_chorus}\nStray line');
        expect(sections[1].lines).toEqual(['Stray line']);
    });

    it('ignores {chorus} and other unknown directives', () => {
        const { sections } = parseChordPro('{start_of_chorus}\nA\n{end_of_chorus}\n{chorus}\n{key: G}');
        expect(sections).toHaveLength(1);
    });

    it('keeps reading metadata', () => {
        expect(parseChordPro('{meta: title Foo Bar}\nx').metadata.title).toBe('Foo Bar');
    });
});

describe('parseChordPro: comments', () => {
    it('turns top-level comments into comment sections in order', () => {
        const { sections } = parseChordPro('{c: Capo 2}\nA\n{comment: Repeat}\nB');
        expect(sections.map(s => [s.type, s.label])).toEqual([
            ['comment', 'Capo 2'], ['verse', 'Verse 1'], ['comment', 'Repeat'], ['verse', 'Verse 2']]);
    });

    it('keeps an in-section comment in place and renders it as a label line', () => {
        const { sections } = parseChordPro('{start_of_verse}\nA\n{comment: C   G}\nB\n{end_of_verse}');
        expect(sections).toHaveLength(1);
        const html = renderSectionsHtml(sections, {});
        expect(html).toContain('song-comment');
        expect(html.indexOf('C   G')).toBeGreaterThan(html.indexOf('>A<'));
        expect(html.indexOf('C   G')).toBeLessThan(html.indexOf('>B<'));
        expect(renderSectionsAscii(sections, {})).toBe('Verse\nA\nC   G\nB\n');
    });

    it('drops chord-only comments (importer leftovers) in and out of sections', () => {
        const a = parseChordPro('{start_of_verse}\nA\n{comment: C   G}\nB\n{end_of_verse}');
        expect(a.sections[0].lines).toEqual(['A', 'B']);
        expect(renderSectionsHtml(a.sections, {})).not.toContain('song-comment');
        const b = parseChordPro('{comment: F#m}\nA');
        expect(b.sections.map(s => s.type)).toEqual(['verse']);
        const c = parseChordPro('{start_of_verse}\nA\n{comment: A-11}\n{end_of_verse}');
        expect(c.sections[0].lines.length).toBe(2);
    });

    it('renders comment sections on all three paths and never as repeats', () => {
        const { sections } = parseChordPro('{c: G}\nA\n{c: G}\nA');
        expect(renderSectionsHtml(sections, { compact: true })).not.toContain('Repeat');
        expect(renderSectionsAscii(sections, {})).toContain('G\n');
        expect(renderSectionsPrintHtml(sections, {})).toContain('section-comment');
    });
});

describe('parseChordPro: tab and grid blocks', () => {
    it('keeps tab lines verbatim and does not chord-parse them', () => {
        const tab = 'e|--[3]--0--|\nB|---1------|';
        const { sections } = parseChordPro(`{start_of_tab}\n${tab}\n{end_of_tab}`);
        expect(sections[0]).toMatchObject({ type: 'tab', preformatted: true });
        expect(sections[0].lines).toEqual(tab.split('\n'));
        expect(renderSectionsHtml(sections, {})).toContain('<pre class="section-preformatted">');
        expect(renderSectionsAscii(sections, {})).toContain('e|--[3]--0--|');
        expect(renderSectionsPrintHtml(sections, {})).toContain('e|--[3]--0--|');
    });

    it('keeps blank lines inside a grid block', () => {
        const { sections } = parseChordPro('{start_of_grid}\n| G | C |\n\n| D | G |\n{end_of_grid}');
        expect(sections[0].lines).toEqual(['| G | C |', '', '| D | G |']);
    });
});

describe('parseChordPro: ABC untouched', () => {
    it('keeps abc as a notation section and ignores its contents', () => {
        const { sections } = parseChordPro('{start_of_abc}\nX:1\nK:G\n{end_of_abc}\nLyric');
        expect(sections[0]).toEqual({ type: 'abc', label: 'Notation', abc: 'X:1\nK:G' });
        expect(sections[1].lines).toEqual(['Lyric']);
    });
});

describe('corpus regression', () => {
    const worksDir = path.resolve(__dirname, '../../../works');
    const files = fs.existsSync(worksDir)
        ? fs.readdirSync(worksDir).flatMap(d => {
            const dir = path.join(worksDir, d);
            return fs.statSync(dir).isDirectory()
                ? fs.readdirSync(dir).filter(f => f.endsWith('.pro')).map(f => path.join(dir, f))
                : [];
        })
        : [];

    it('no lead sheet renders fewer lyric lines than it contains', () => {
        const bad = [];
        for (const f of files) {
            const text = fs.readFileSync(f, 'utf8');
            const stripped = text.replace(/\{start_of_abc\}[\s\S]*?\{end_of_abc\}/gi, '');
            const expected = stripped.split('\n')
                .filter(l => l.trim() && !/^\s*\{.*\}\s*$/.test(l)).length;
            const { sections } = parseChordPro(text);
            const got = sections
                .filter(s => s.type !== 'abc' && s.type !== 'comment')
                .reduce((n, s) => n + s.lines.filter(l => l.charCodeAt(0) !== 1 && l.trim()).length, 0);
            if (got < expected) bad.push(`${path.relative(worksDir, f)}: ${got} < ${expected}`);
        }
        expect(bad).toEqual([]);
    });
});
