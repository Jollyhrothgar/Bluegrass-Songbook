// Unit tests for song-view.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock state.js
vi.mock('../state.js', () => ({
    currentSong: null,
    setCurrentSong: vi.fn(),
    currentChordpro: null,
    setCurrentChordpro: vi.fn(),
    allSongs: [],
    songGroups: {},
    compactMode: false,
    setCompactMode: vi.fn(),
    nashvilleMode: false,
    setNashvilleMode: vi.fn(),
    twoColumnMode: false,
    setTwoColumnMode: vi.fn(),
    chordDisplayMode: 'all',
    setChordDisplayMode: vi.fn(),
    seenChordPatterns: new Set(),
    clearSeenChordPatterns: vi.fn(),
    addSeenChordPattern: vi.fn(),
    showSectionLabels: true,
    setShowSectionLabels: vi.fn(),
    showChordProSource: false,
    setShowChordProSource: vi.fn(),
    fontSizeLevel: 0,
    setFontSizeLevel: vi.fn(),
    FONT_SIZES: { '-2': 0.7, '-1': 0.85, '0': 1, '1': 1.2, '2': 1.5 },
    currentDetectedKey: null,
    setCurrentDetectedKey: vi.fn(),
    originalDetectedKey: null,
    setOriginalDetectedKey: vi.fn(),
    originalDetectedMode: null,
    setOriginalDetectedMode: vi.fn(),
    historyInitialized: false,
    showAbcNotation: true,
    setShowAbcNotation: vi.fn(),
    abcjsRendered: null,
    setAbcjsRendered: vi.fn(),
    currentAbcContent: null,
    setCurrentAbcContent: vi.fn(),
    abcTempoBpm: 120,
    setAbcTempoBpm: vi.fn(),
    abcTranspose: 0,
    setAbcTranspose: vi.fn(),
    abcScale: 1.0,
    setAbcScale: vi.fn(),
    abcSynth: null,
    setAbcSynth: vi.fn(),
    abcTimingCallbacks: null,
    setAbcTimingCallbacks: vi.fn(),
    abcIsPlaying: false,
    setAbcIsPlaying: vi.fn(),
    fullscreenMode: false,
    setFullscreenMode: vi.fn(),
    listContext: null,
    setListContext: vi.fn()
}));

vi.mock('../utils.js', () => ({
    escapeHtml: vi.fn((text) => text)
}));

vi.mock('../chords.js', () => ({
    parseLineWithChords: vi.fn((line) => {
        const chords = [];
        let lyrics = '';
        const regex = /\[([^\]]+)\]/g;
        let match;
        let lastIndex = 0;
        while ((match = regex.exec(line)) !== null) {
            lyrics += line.slice(lastIndex, match.index);
            chords.push({ chord: match[1], position: lyrics.length });
            lastIndex = regex.lastIndex;
        }
        lyrics += line.slice(lastIndex);
        return { chords, lyrics };
    }),
    extractChords: vi.fn(() => []),
    detectKey: vi.fn(() => ({ key: 'G', mode: 'major' })),
    getSemitonesBetweenKeys: vi.fn(() => 0),
    transposeChord: vi.fn((chord) => chord),
    toNashville: vi.fn((chord) => chord)
}));

vi.mock('../lists.js', () => ({
    updateListPickerButton: vi.fn(),
    updateFavoriteButton: vi.fn()
}));

vi.mock('../tags.js', () => ({
    renderTagBadges: vi.fn(() => ''),
    getTagCategory: vi.fn(() => 'genre'),
    formatTagName: vi.fn((tag) => tag)
}));

vi.mock('../analytics.js', () => ({
    trackSongView: vi.fn(),
    trackTranspose: vi.fn(),
    trackVersionPicker: vi.fn(),
    trackTagVote: vi.fn(),
    trackTagSuggest: vi.fn(),
    endSongView: vi.fn(),
    trackTagsExpand: vi.fn()
}));

vi.mock('../flags.js', () => ({
    openFlagModal: vi.fn()
}));

import { parseChordPro } from '../song-view.js';

describe('parseChordPro', () => {
    describe('metadata parsing', () => {
        it('parses title metadata', () => {
            const content = '{meta: title Your Cheatin Heart}\n{start_of_verse}\nLyrics here\n{end_of_verse}';
            const result = parseChordPro(content);
            expect(result.metadata.title).toBe('Your Cheatin Heart');
        });

        it('parses artist metadata', () => {
            const content = '{meta: artist Hank Williams}\n{start_of_verse}\nLyrics\n{end_of_verse}';
            const result = parseChordPro(content);
            expect(result.metadata.artist).toBe('Hank Williams');
        });

        it('parses multiple metadata fields', () => {
            const content = `{meta: title Blue Moon}
{meta: artist Bill Monroe}
{meta: key G}
{start_of_verse}
Lyrics
{end_of_verse}`;
            const result = parseChordPro(content);
            expect(result.metadata.title).toBe('Blue Moon');
            expect(result.metadata.artist).toBe('Bill Monroe');
            expect(result.metadata.key).toBe('G');
        });

        it('handles lowercase metadata keys', () => {
            const content = '{meta: Title Your Song}\n{start_of_verse}\nTest\n{end_of_verse}';
            const result = parseChordPro(content);
            expect(result.metadata.title).toBe('Your Song');
        });
    });

    describe('section parsing', () => {
        it('parses verse sections', () => {
            const content = `{start_of_verse}
[G]First line
[C]Second line
{end_of_verse}`;
            const result = parseChordPro(content);
            expect(result.sections).toHaveLength(1);
            expect(result.sections[0].type).toBe('verse');
            expect(result.sections[0].lines).toHaveLength(2);
        });

        it('parses chorus sections', () => {
            const content = `{start_of_chorus}
[D]Chorus line
{end_of_chorus}`;
            const result = parseChordPro(content);
            expect(result.sections).toHaveLength(1);
            expect(result.sections[0].type).toBe('chorus');
        });

        it('parses bridge sections', () => {
            const content = `{start_of_bridge}
Bridge lyrics
{end_of_bridge}`;
            const result = parseChordPro(content);
            expect(result.sections).toHaveLength(1);
            expect(result.sections[0].type).toBe('bridge');
        });

        it('parses section labels', () => {
            const content = `{start_of_verse: Verse 1}
First verse
{end_of_verse}
{start_of_verse: Verse 2}
Second verse
{end_of_verse}`;
            const result = parseChordPro(content);
            expect(result.sections).toHaveLength(2);
            expect(result.sections[0].label).toBe('Verse 1');
            expect(result.sections[1].label).toBe('Verse 2');
        });

        it('uses default label when not specified', () => {
            const content = `{start_of_verse}
Lyrics
{end_of_verse}`;
            const result = parseChordPro(content);
            expect(result.sections[0].label).toBe('Verse');
        });

        it('parses multiple mixed sections', () => {
            const content = `{start_of_verse: Verse 1}
[G]Verse lyrics
{end_of_verse}
{start_of_chorus}
[C]Chorus lyrics
{end_of_chorus}
{start_of_verse: Verse 2}
[D]More verse
{end_of_verse}`;
            const result = parseChordPro(content);
            expect(result.sections).toHaveLength(3);
            expect(result.sections[0].type).toBe('verse');
            expect(result.sections[1].type).toBe('chorus');
            expect(result.sections[2].type).toBe('verse');
        });
    });

    describe('ABC notation blocks', () => {
        it('parses ABC notation sections', () => {
            const content = `{start_of_verse}
Lyrics
{end_of_verse}
{start_of_abc}
X:1
T:Melody
M:4/4
K:G
GABC|
{end_of_abc}`;
            const result = parseChordPro(content);
            expect(result.sections).toHaveLength(2);
            expect(result.sections[1].type).toBe('abc');
            expect(result.sections[1].abc).toContain('X:1');
            expect(result.sections[1].abc).toContain('K:G');
        });

        it('preserves ABC content exactly', () => {
            const content = `{start_of_abc}
X:1
M:4/4
L:1/8
K:G
|:GABc dedc|
{end_of_abc}`;
            const result = parseChordPro(content);
            expect(result.sections[0].abc).toContain('|:GABc dedc|');
        });
    });

    describe('chord extraction from lines', () => {
        it('preserves chords in section lines', () => {
            const content = `{start_of_verse}
[G]Hello [C]world
{end_of_verse}`;
            const result = parseChordPro(content);
            expect(result.sections[0].lines[0]).toBe('[G]Hello [C]world');
        });

        it('preserves complex chord notation', () => {
            const content = `{start_of_verse}
[Gmaj7]Start [F#m7]middle [Bdim]end
{end_of_verse}`;
            const result = parseChordPro(content);
            expect(result.sections[0].lines[0]).toContain('[Gmaj7]');
            expect(result.sections[0].lines[0]).toContain('[F#m7]');
        });
    });

    describe('edge cases', () => {
        it('handles empty content', () => {
            const result = parseChordPro('');
            expect(result.metadata).toEqual({});
            expect(result.sections).toEqual([]);
        });

        it('ignores unknown directives', () => {
            const content = `{unknown_directive}
{custom: value}
{start_of_verse}
Test
{end_of_verse}`;
            const result = parseChordPro(content);
            expect(result.sections).toHaveLength(1);
        });

        it('ignores lines outside sections', () => {
            const content = `Orphan line before
{start_of_verse}
Inside section
{end_of_verse}
Orphan line after`;
            const result = parseChordPro(content);
            expect(result.sections).toHaveLength(1);
            expect(result.sections[0].lines).toHaveLength(1);
            expect(result.sections[0].lines[0]).toBe('Inside section');
        });

        it('skips empty lines within sections', () => {
            const content = `{start_of_verse}
Line one

Line two
{end_of_verse}`;
            const result = parseChordPro(content);
            expect(result.sections[0].lines).toHaveLength(2);
        });

        it('handles multiline metadata values', () => {
            const content = `{meta: title Blue Moon of Kentucky}
{start_of_verse}
Test
{end_of_verse}`;
            const result = parseChordPro(content);
            expect(result.metadata.title).toBe('Blue Moon of Kentucky');
        });
    });
});
