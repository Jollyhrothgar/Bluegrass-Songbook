// Tests for exporting a whole list as one file (#206 follow-up).
//
// The value of a list export is that it opens in someone ELSE'S ChordPro
// reader, so these lock down the two portability decisions: {new_song}
// between songs, and standard metadata emitted as standalone directives
// rather than the {meta: ...} form many external tools ignore.
import { describe, it, expect } from 'vitest';

import {
    normalizeChordProMeta,
    stripToPlainText,
    buildListChordPro,
    buildListText,
    buildListZipFiles,
    listFileBase,
} from '../list-export.js';

const SONG_A = {
    id: 'a', title: 'How Long Blues', artist: 'Del McCoury',
};
const CONTENT_A = `{meta: title How Long Blues}
{meta: artist Del McCoury}
{meta: composer Leroy Carr}
{key: E}
{meta: x_source web-chords}

{start_of_chorus: Chorus}
[E]How long, how [E7]long
{end_of_chorus}`;

const SONG_B = { id: 'b', title: 'Sally Goodin', artist: 'The Price Sisters' };
const CONTENT_B = `{meta: title Sally Goodin}

{start_of_verse: Verse 1}
[A]Had a piece of pie
{end_of_verse}`;

describe('normalizeChordProMeta', () => {
    it('rewrites standard meta names to standalone directives', () => {
        const out = normalizeChordProMeta(CONTENT_A);
        expect(out).toContain('{title: How Long Blues}');
        expect(out).toContain('{artist: Del McCoury}');
        expect(out).toContain('{composer: Leroy Carr}');
    });

    it('leaves non-standard meta alone', () => {
        // x_source has no standalone directive - {meta: ...} is correct for it.
        expect(normalizeChordProMeta(CONTENT_A)).toContain('{meta: x_source web-chords}');
    });

    it('leaves directives that are already standalone untouched', () => {
        expect(normalizeChordProMeta('{key: E}')).toBe('{key: E}');
    });

    it('does not disturb chords or lyrics', () => {
        expect(normalizeChordProMeta(CONTENT_A)).toContain('[E]How long, how [E7]long');
    });

    it('tolerates empty input', () => {
        expect(normalizeChordProMeta('')).toBe('');
        expect(normalizeChordProMeta(undefined)).toBe('');
    });
});

describe('buildListChordPro', () => {
    it('separates songs with {new_song}', () => {
        const out = buildListChordPro([SONG_A, SONG_B], [CONTENT_A, CONTENT_B]);
        expect(out.match(/\{new_song\}/g)).toHaveLength(1);
    });

    it('does not emit {new_song} before the first song', () => {
        // The directive is implied at the start of a file.
        const out = buildListChordPro([SONG_A], [CONTENT_A]);
        expect(out).not.toContain('{new_song}');
        expect(out.trimStart().startsWith('{title:')).toBe(true);
    });

    it('gives every song a {title:} an external reader will recognise', () => {
        const out = buildListChordPro([SONG_A, SONG_B], [CONTENT_A, CONTENT_B]);
        expect(out.match(/^\{title:/gm)).toHaveLength(2);
    });

    it('synthesises a title when the source has no title metadata', () => {
        const out = buildListChordPro([SONG_A], ['[E]just chords, no metadata']);
        expect(out).toContain('{title: How Long Blues}');
    });

    it('skips songs with no content instead of emitting empty entries', () => {
        const out = buildListChordPro([SONG_A, SONG_B], [CONTENT_A, '']);
        expect(out).not.toContain('{new_song}');
        expect(out).toContain('How Long Blues');
        expect(out).not.toContain('Sally Goodin');
    });

    it('handles an empty list without producing a stray separator', () => {
        expect(buildListChordPro([], []).trim()).toBe('');
    });
});

describe('buildListText', () => {
    it('heads each song with its title and artist', () => {
        const out = buildListText([SONG_A, SONG_B], [CONTENT_A, CONTENT_B]);
        expect(out).toContain('How Long Blues\nDel McCoury');
        expect(out).toContain('Sally Goodin\nThe Price Sisters');
    });

    it('strips chords and directives from the body', () => {
        const out = buildListText([SONG_A], [CONTENT_A]);
        expect(out).toContain('How long, how long');
        expect(out).not.toContain('[E7]');
        expect(out).not.toContain('start_of_chorus');
    });

    it('separates songs with a visible rule', () => {
        const out = buildListText([SONG_A, SONG_B], [CONTENT_A, CONTENT_B]);
        expect(out).toContain('-'.repeat(40));
    });
});

describe('stripToPlainText', () => {
    it('collapses the blank lines left behind by removed directives', () => {
        expect(stripToPlainText('{a}\n\n\n\n{b}\nword')).toBe('word');
    });
});

describe('listFileBase', () => {
    it('removes characters filesystems reject', () => {
        expect(listFileBase('Sunday/Jam: "best" <picks>')).toBe('SundayJam best picks');
    });

    it('falls back when a name is empty or all-illegal', () => {
        expect(listFileBase('')).toBe('songbook-list');
        expect(listFileBase('///')).toBe('songbook-list');
        expect(listFileBase(undefined)).toBe('songbook-list');
    });

    it('bounds the length', () => {
        expect(listFileBase('x'.repeat(200)).length).toBeLessThanOrEqual(80);
    });
});

describe('buildListZipFiles', () => {
    it('emits one file per song, named from the title', () => {
        const files = buildListZipFiles([SONG_A, SONG_B], [CONTENT_A, CONTENT_B]);
        expect(files.map(f => f.name)).toEqual(['How Long Blues.pro', 'Sally Goodin.pro']);
    });

    it('normalises metadata the same way the combined export does', () => {
        const [file] = buildListZipFiles([SONG_A], [CONTENT_A]);
        expect(file.content).toContain('{title: How Long Blues}');
        expect(file.content).toContain('{meta: x_source web-chords}');
    });

    it('never emits {new_song} - each file is a single song', () => {
        const files = buildListZipFiles([SONG_A, SONG_B], [CONTENT_A, CONTENT_B]);
        for (const f of files) expect(f.content).not.toContain('{new_song}');
    });

    it('deduplicates names when two works share a title', () => {
        // A list can hold two arrangements of the same song; without this the
        // zip would extract to a single file.
        const dup = { id: 'c', title: 'How Long Blues', artist: 'Someone Else' };
        const files = buildListZipFiles(
            [SONG_A, dup],
            [CONTENT_A, '{meta: title How Long Blues}\n[E]other version\n']
        );
        expect(files.map(f => f.name)).toEqual(['How Long Blues.pro', 'How Long Blues (2).pro']);
    });

    it('skips songs with no content', () => {
        const files = buildListZipFiles([SONG_A, SONG_B], [CONTENT_A, '']);
        expect(files).toHaveLength(1);
    });

    it('ends every file with a newline', () => {
        const files = buildListZipFiles([SONG_A, SONG_B], [CONTENT_A, CONTENT_B]);
        for (const f of files) expect(f.content.endsWith('\n')).toBe(true);
    });
});
