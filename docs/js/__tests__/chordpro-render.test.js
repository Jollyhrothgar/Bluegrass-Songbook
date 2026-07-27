// Golden-output tests for the shared ChordPro renderer (renderers/chordpro.js)
// No mocks: uses the real chords.js/utils.js so transposition and Nashville
// conversion are exercised end-to-end.
import { describe, it, expect } from 'vitest';
import {
    parseChordPro,
    renderSectionsHtml,
    renderSectionsAscii,
    renderSectionsPrintHtml
} from '../renderers/chordpro.js';

const MINI_SONG = `{meta: title Mini}
{start_of_verse}
[G]Hello [C]world
{end_of_verse}`;

const NORMAL_SONG = `{meta: title Down in the Valley}
{meta: artist Tester}
{start_of_verse: Verse 1}
[G]Down in the [C]valley [D]low
{end_of_verse}
{start_of_chorus}
[G]Sing it [D]loud
{end_of_chorus}
{start_of_verse: Verse 2}
[G]Down in the [C]valley [D]low
{end_of_verse}`;

const MINOR_SONG = `{meta: title Lonesome Minor}
{start_of_verse}
[Am]Dark and [F]lonesome [E]night
{end_of_verse}`;

const REPEAT_SONG = `{start_of_verse: Verse 1}
[G]First verse [C]here
{end_of_verse}
{start_of_chorus}
[G]Chorus [D]line
{end_of_chorus}
{start_of_verse: Verse 2}
[G]Second verse [C]now
{end_of_verse}
{start_of_chorus}
[G]Chorus [D]line
{end_of_chorus}`;

const sectionsOf = (src) => parseChordPro(src).sections;

describe('renderSectionsHtml', () => {
    it('renders a normal song to the exact screen DOM structure', () => {
        const html = renderSectionsHtml(sectionsOf(MINI_SONG), { key: 'G' });
        expect(html).toBe(`
        <div class="song-section ">
            <div class="section-label">Verse</div>
            <div class="section-content"><div class="song-line cl-line"><span class="cl-segment"><span class="cl-chord">G</span>Hello </span><span class="cl-segment"><span class="cl-chord">C</span>world</span></div></div>
        </div>
    `);
    });

    it('indents choruses and repeated-label sections', () => {
        const html = renderSectionsHtml(sectionsOf(NORMAL_SONG), { key: 'G' });
        // Chorus gets section-indent; both verses share the label count logic
        expect(html).toContain('<div class="section-label">Chorus</div>');
        expect(html.match(/song-section section-indent/g)).toHaveLength(1);
        expect(html).toContain('<div class="section-label">Verse 1</div>');
        expect(html).toContain('<div class="section-label">Verse 2</div>');
    });

    it('transposes when transposeTo differs from key', () => {
        const html = renderSectionsHtml(sectionsOf(MINI_SONG), { key: 'G', transposeTo: 'A' });
        expect(html).toContain('<span class="cl-chord">A</span>Hello ');
        expect(html).toContain('<span class="cl-chord">D</span>world');
    });

    it('accepts an explicit semitones override', () => {
        const html = renderSectionsHtml(sectionsOf(MINI_SONG), { key: 'G', semitones: 2 });
        expect(html).toContain('<span class="cl-chord">A</span>');
        expect(html).toContain('<span class="cl-chord">D</span>');
    });

    it('renders Nashville numbers relative to the target key', () => {
        const html = renderSectionsHtml(sectionsOf(NORMAL_SONG), { key: 'G', nashville: true });
        expect(html).toContain('<span class="cl-chord">I</span>');
        expect(html).toContain('<span class="cl-chord">IV</span>');
        expect(html).toContain('<span class="cl-chord">V</span>');
        expect(html).not.toContain('<span class="cl-chord">G</span>');
    });

    it('renders a minor-key song with minor Nashville numerals', () => {
        const html = renderSectionsHtml(sectionsOf(MINOR_SONG), { key: 'Am', nashville: true });
        expect(html).toContain('<span class="cl-chord">i</span>');
        expect(html).toContain('<span class="cl-chord">VI</span>');
        // E major in Am: expected minor v, actual major -> uppercase V
        expect(html).toContain('<span class="cl-chord">V</span>');
    });

    it('chordMode none renders plain lyric lines', () => {
        const html = renderSectionsHtml(sectionsOf(MINI_SONG), { key: 'G', chordMode: 'none' });
        expect(html).toContain('<div class="song-line"><div class="lyrics-line">Hello world</div></div>');
        expect(html).not.toContain('cl-chord');
    });

    it('chordMode first hides chords on later sections with an already-seen chord pattern', () => {
        const html = renderSectionsHtml(sectionsOf(REPEAT_SONG), { key: 'G', chordMode: 'first' });
        // Verse 1 (G-C) keeps chords; Verse 2 repeats the G-C pattern -> hidden
        expect(html).toContain('<span class="cl-chord">G</span>First verse ');
        expect(html).toContain('<div class="lyrics-line">Second verse now</div>');
        // First chorus keeps chords (G-D pattern is new); second chorus loses them
        expect(html).toContain('<span class="cl-chord">G</span>Chorus ');
        expect(html).toContain('<div class="lyrics-line">Chorus line</div>');
    });

    it('compact mode collapses identical repeated sections into a repeat indicator', () => {
        const html = renderSectionsHtml(sectionsOf(REPEAT_SONG), { key: 'G', compact: true });
        expect(html).toContain('<div class="section-repeat section-indent">(Repeat Chorus)</div>');
        // Only the first chorus is rendered in full
        expect(html.match(/<div class="section-label">Chorus<\/div>/g)).toHaveLength(1);
    });

    it('omits section labels when sectionLabels is false', () => {
        const html = renderSectionsHtml(sectionsOf(MINI_SONG), { key: 'G', sectionLabels: false });
        expect(html).not.toContain('section-label');
    });

    it('skips abc sections', () => {
        const src = `{start_of_verse}\n[G]Words\n{end_of_verse}\n{start_of_abc}\nX:1\nK:G\n{end_of_abc}`;
        const html = renderSectionsHtml(sectionsOf(src), { key: 'G' });
        expect(html).not.toContain('X:1');
    });
});

describe('renderSectionsAscii', () => {
    it('renders chord lines positioned above lyrics (golden)', () => {
        const src = `{start_of_verse: Verse 1}\n[G]Down in the [C]valley\n{end_of_verse}`;
        const text = renderSectionsAscii(sectionsOf(src), { key: 'G' });
        expect(text).toBe(
            'Verse 1\n' +
            'G           C\n' +
            'Down in the valley\n'
        );
    });

    it('nudges colliding chords right by one space', () => {
        const src = `{start_of_verse}\n[G][C]Tight\n{end_of_verse}`;
        const text = renderSectionsAscii(sectionsOf(src), { key: 'G' });
        expect(text).toBe('Verse\nG C\nTight\n');
    });

    it('renders Nashville chord lines when requested', () => {
        const src = `{start_of_verse}\n[G]Down in the [C]valley\n{end_of_verse}`;
        const text = renderSectionsAscii(sectionsOf(src), { key: 'G', nashville: true, sectionLabels: false });
        expect(text).toBe(
            'I           IV\n' +
            'Down in the valley\n'
        );
    });

    it('transposes via semitones', () => {
        const src = `{start_of_verse}\n[G]Hello [C]world\n{end_of_verse}`;
        const text = renderSectionsAscii(sectionsOf(src), { key: 'G', semitones: 2, sectionLabels: false });
        expect(text).toBe('A     D\nHello world\n');
    });

    it('chordMode none drops chord lines', () => {
        const src = `{start_of_verse}\n[G]Hello [C]world\n{end_of_verse}`;
        const text = renderSectionsAscii(sectionsOf(src), { key: 'G', chordMode: 'none', sectionLabels: false });
        expect(text).toBe('Hello world\n');
    });

    it('chordMode first drops chords on content-repeated sections only', () => {
        const text = renderSectionsAscii(sectionsOf(REPEAT_SONG), { key: 'G', chordMode: 'first' });
        expect(text).toBe(
            'Verse 1\n' +
            'G           C\n' +
            'First verse here\n' +
            '\n' +
            'Chorus\n' +
            'G      D\n' +
            'Chorus line\n' +
            '\n' +
            'Verse 2\n' +
            'G            C\n' +
            'Second verse now\n' +
            '\n' +
            'Chorus\n' +
            'Chorus line\n'
        );
    });

    it('compact mode emits repeat markers for content-repeated sections', () => {
        const text = renderSectionsAscii(sectionsOf(REPEAT_SONG), { key: 'G', compact: true });
        expect(text).toContain('[Repeat Chorus]');
        expect(text.match(/Chorus line/g)).toHaveLength(1);
    });
});

describe('renderSectionsPrintHtml', () => {
    it('emits both standard and Nashville chord lines for CSS toggling', () => {
        const html = renderSectionsPrintHtml(sectionsOf(MINI_SONG), { key: 'G' });
        expect(html).toContain('<div class="chord-line standard">G     C</div>');
        expect(html).toContain('<div class="chord-line nashville">I     IV</div>');
        expect(html).toContain('<div class="lyric-line">Hello world</div>');
    });

    it('marks content-repeated sections and pairs them with a repeat instruction', () => {
        const html = renderSectionsPrintHtml(sectionsOf(REPEAT_SONG), { key: 'G' });
        expect(html.match(/class="section is-repeat"/g)).toHaveLength(1);
        expect(html).toContain('<div class="repeat-instruction">[Repeat Chorus]</div>');
    });

    it('always includes section labels (visibility is a CSS concern)', () => {
        const html = renderSectionsPrintHtml(sectionsOf(NORMAL_SONG), { key: 'G' });
        expect(html).toContain('<div class="section-label">Verse 1</div>');
        expect(html).toContain('<div class="section-label">Chorus</div>');
    });
});

describe('parseChordPro re-export shim', () => {
    it('song-view.js still exports parseChordPro', async () => {
        const songView = await import('../song-view.js');
        expect(songView.parseChordPro).toBe(parseChordPro);
    });
});
