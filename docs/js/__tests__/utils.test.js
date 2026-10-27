// Unit tests for utils.js
import { describe, it, expect } from 'vitest';
import {
    escapeHtml, escapeRegex, highlightMatch, partUsesSongActions, buildDeleteCandidates,
    songWriter, writtenByLabel, associatedArtists, matchedArtists,
    recordedBy, recorderLabel, recordingSearchUrl,
} from '../utils.js';

describe('buildDeleteCandidates', () => {
    const flatt = {
        id: 'roll-in-my-sweet-baby-s-arms', title: "Roll In My Sweet Baby's Arms",
        source: 'trusted-user', key: 'G', chord_count: 3,
        first_line: "I ain't gonna work on the railroad", group_id: 'grp1',
    };
    const bgLyrics = {
        id: 'roll-in-my-sweet-babys-arms', title: 'Roll In My Sweet Baby’s Arms',
        source: 'bluegrass-lyrics', key: 'G', chord_count: 3,
        first_line: 'Roll in my sweet baby’s arms', group_id: 'grp1',
    };

    it('lists every group member, marking the viewed one', () => {
        const rows = buildDeleteCandidates(bgLyrics, { grp1: [flatt, bgLyrics] });
        expect(rows).toHaveLength(2);
        expect(rows.find(r => r.id === bgLyrics.id).isCurrent).toBe(true);
        expect(rows.find(r => r.id === flatt.id).isCurrent).toBe(false);
        expect(rows.find(r => r.id === flatt.id).source).toBe('trusted-user');
    });

    it('falls back to the song itself without a group', () => {
        const solo = { ...flatt, group_id: undefined };
        const rows = buildDeleteCandidates(solo, {});
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: flatt.id, isCurrent: true });
    });

    it('handles missing metadata gracefully', () => {
        const rows = buildDeleteCandidates({ id: 'x', group_id: 'g' }, { g: [{ id: 'x' }] });
        expect(rows[0]).toMatchObject({ title: 'x', source: 'unknown', chordCount: 0, firstLine: '' });
    });

    it('returns empty for no song', () => {
        expect(buildDeleteCandidates(null, {})).toEqual([]);
    });
});

describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
        expect(escapeHtml('a & b')).toBe('a &amp; b');
        // DOM-based escaping doesn't escape quotes (not needed outside attributes)
        expect(escapeHtml('"quoted"')).toBe('"quoted"');
    });

    it('returns plain text unchanged', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
    });
});

describe('partUsesSongActions', () => {
    it('hides the header Edit for tablature parts', () => {
        expect(partUsesSongActions({ type: 'tablature', instrument: 'banjo' })).toBe(false);
    });

    it('shows it for chordpro parts and unknown/missing parts', () => {
        expect(partUsesSongActions({ type: 'chordpro' })).toBe(true);
        expect(partUsesSongActions({ type: 'abc' })).toBe(true);
        expect(partUsesSongActions(null)).toBe(true);
        expect(partUsesSongActions(undefined)).toBe(true);
    });
});

describe('escapeRegex', () => {
    it('escapes regex special characters', () => {
        expect(escapeRegex('a.b')).toBe('a\\.b');
        expect(escapeRegex('a*b')).toBe('a\\*b');
        expect(escapeRegex('a+b')).toBe('a\\+b');
        expect(escapeRegex('a?b')).toBe('a\\?b');
        expect(escapeRegex('a[b]c')).toBe('a\\[b\\]c');
    });

    it('returns plain text unchanged', () => {
        expect(escapeRegex('hello world')).toBe('hello world');
    });
});

describe('highlightMatch', () => {
    it('highlights single term', () => {
        expect(highlightMatch('Hello World', 'world')).toBe('Hello <mark>World</mark>');
    });

    it('highlights multiple occurrences', () => {
        expect(highlightMatch('one two one', 'one')).toBe('<mark>one</mark> two <mark>one</mark>');
    });

    it('case insensitive matching', () => {
        expect(highlightMatch('HELLO hello Hello', 'hello')).toBe(
            '<mark>HELLO</mark> <mark>hello</mark> <mark>Hello</mark>'
        );
    });

    it('highlights multiple terms', () => {
        expect(highlightMatch('red blue green', 'red green')).toBe(
            '<mark>red</mark> blue <mark>green</mark>'
        );
    });

    it('escapes HTML in text', () => {
        expect(highlightMatch('<b>bold</b>', 'bold')).toBe(
            '&lt;b&gt;<mark>bold</mark>&lt;/b&gt;'
        );
    });

    it('returns escaped text when query is empty', () => {
        expect(highlightMatch('<script>', '')).toBe('&lt;script&gt;');
    });

    it('returns escaped text when no matches', () => {
        expect(highlightMatch('hello world', 'xyz')).toBe('hello world');
    });

    it('merges overlapping matches', () => {
        // 'on' matches 'on' and 'one' also matches 'on'
        const result = highlightMatch('one two', 'on one');
        expect(result).toBe('<mark>one</mark> two');
    });

    it('merges adjacent matches into single highlight', () => {
        // Adjacent matches get merged into one continuous highlight
        expect(highlightMatch('ab', 'a b')).toBe('<mark>ab</mark>');
    });

    // Regression test: searching for terms containing "m", "a", "r", or "k"
    // used to corrupt the <mark> tags added by previous term replacements.
    // The bug caused output like "Sark>onark>s" instead of "S<mark>on</mark>s"
    describe('mark tag corruption bug (regression)', () => {
        // Helper to verify HTML is well-formed and content is preserved
        function assertValidHighlight(result, originalText) {
            // Balanced mark tags
            const markCount = (result.match(/<mark>/g) || []).length;
            const closeMarkCount = (result.match(/<\/mark>/g) || []).length;
            expect(markCount).toBe(closeMarkCount);

            // No malformed tags (doubled angle brackets from nested replacements)
            expect(result).not.toContain('<<');
            expect(result).not.toContain('>>');

            // Original text content preserved (after stripping tags)
            const stripped = result.replace(/<\/?mark>/g, '');
            expect(stripped).toBe(originalText);
        }

        it('does not corrupt when searching for "m"', () => {
            const result = highlightMatch('Sons of the Pioneers', 'on m');
            assertValidHighlight(result, 'Sons of the Pioneers');
            expect(result).toContain('<mark>');
        });

        it('does not corrupt when searching for "mark"', () => {
            const result = highlightMatch('Hello Mark', 'mark');
            expect(result).toBe('Hello <mark>Mark</mark>');
        });

        it('does not corrupt when searching for "a" with other terms', () => {
            const result = highlightMatch('When The Bloom Is On The Sage', 'on a');
            assertValidHighlight(result, 'When The Bloom Is On The Sage');
        });

        it('handles all letters in "mark" as search terms', () => {
            // This would maximally corrupt the old implementation
            const result = highlightMatch('Sample Text', 'm a r k');
            assertValidHighlight(result, 'Sample Text');
        });

        it('the exact bug case from issue report', () => {
            // Original bug: searching "on m" turned
            // "When The Bloom Is On The Sage" into "When The Bloom Is ark>Onark> The Sage"
            const result = highlightMatch('When The Bloom Is On The Sage', 'on m');
            assertValidHighlight(result, 'When The Bloom Is On The Sage');
            // "On" should be properly highlighted
            expect(result).toContain('<mark>On</mark>');
        });

        it('preserves original text content when highlighting', () => {
            const result = highlightMatch('Sons of the Pioneers', 'on');
            const stripped = result.replace(/<\/?mark>/g, '');
            expect(stripped).toBe('Sons of the Pioneers');
        });
    });
});

// F9: `artist` is whichever performer page a chart was scraped from, so it
// is never shown. The writer is the credit; covering artists (MusicBrainz)
// are listed only where someone looks for them. Mirrors build_song_pages.py
// (_writer / associated_artists).
describe('song credits (F9)', () => {
    const sunshine = {
        artist: 'Johnny Cash', composer: 'Jimmie Davis, Charles Mitchell',
        covering_artists: ['Mac Wiseman', 'johnny cash', 'Norman Blake'],
    };

    it('the writer is the composer, else "Traditional" when the artist says so, else nothing', () => {
        expect(songWriter(sunshine)).toBe('Jimmie Davis, Charles Mitchell');
        expect(songWriter({ artist: 'Traditional' })).toBe('Traditional');
        expect(songWriter({ artist: 'Johnny Cash' })).toBe('');
        expect(songWriter({})).toBe('');
    });

    it('labels the writer, and never says "Written by Traditional"', () => {
        expect(writtenByLabel('Bill Monroe')).toBe('Written by Bill Monroe');
        expect(writtenByLabel('traditional')).toBe('Traditional');
        expect(writtenByLabel('')).toBe('');
    });

    it('lists covering artists only, once each, no "Traditional" — never the scraped artist', () => {
        expect(associatedArtists({ ...sunshine, covering_artists: ['Mac Wiseman', 'mac wiseman', 'Norman Blake'] }))
            .toEqual(['Mac Wiseman', 'Norman Blake']);
        expect(associatedArtists({ artist: 'Lester Flatt', covering_artists: ['Mac Wiseman'] }))
            .toEqual(['Mac Wiseman']);
        expect(associatedArtists({ artist: 'Lester Flatt' })).toEqual([]);
        expect(associatedArtists({ covering_artists: ['Traditional'] })).toEqual([]);
        expect(associatedArtists({})).toEqual([]);
    });

    it('recordedBy pairs each covering artist with its year, null when unknown', () => {
        expect(recordedBy({ covering_artists: ['Bill Monroe', 'Doug Dillard', 'Traditional', 'bill monroe'],
            covering_years: [1947, null, 1900, 1950] }))
            .toEqual([{ name: 'Bill Monroe', year: 1947 }, { name: 'Doug Dillard', year: null }]);
        expect(recordedBy({ covering_artists: ['Bill Monroe'] })).toEqual([{ name: 'Bill Monroe', year: null }]);
        expect(recordedBy({ artist: 'Johnny Cash' })).toEqual([]);
    });

    it('labels and links a recording: "Name (year)" and a YouTube search for it', () => {
        expect(recorderLabel({ name: 'Bill Monroe', year: 1947 })).toBe('Bill Monroe (1947)');
        expect(recorderLabel({ name: 'Bill Monroe', year: null })).toBe('Bill Monroe');
        expect(recordingSearchUrl('Blue Moon of Kentucky', { name: 'Bill Monroe', year: 1947 }))
            .toBe('https://www.youtube.com/results?search_query=Blue+Moon+of+Kentucky+Bill+Monroe+1947');
        expect(recordingSearchUrl("Roll in My Sweet Baby's Arms", { name: 'Flatt & Scruggs', year: null }))
            .toBe("https://www.youtube.com/results?search_query=Roll+in+My+Sweet+Baby's+Arms+Flatt+%26+Scruggs");
    });

    describe('matchedArtists: only the artists a search actually asked for', () => {
        it('matches an artist: filter', () => {
            expect(matchedArtists(sunshine, { textTerms: [], artistFilter: 'blake' })).toEqual(['Norman Blake']);
        });
        it('never names the scraped artist, even when the search matched it', () => {
            const scrapedOnly = { artist: 'Johnny Cash', covering_artists: ['Mac Wiseman'] };
            expect(matchedArtists(scrapedOnly, { textTerms: [], artistFilter: 'cash' })).toEqual([]);
        });
        it('matches free text only when every term is in the one name', () => {
            expect(matchedArtists(sunshine, { textTerms: ['mac', 'wiseman'] })).toEqual(['Mac Wiseman']);
            // "sunshine" is a title word — no artist line for a title search.
            expect(matchedArtists(sunshine, { textTerms: ['sunshine'] })).toEqual([]);
            expect(matchedArtists(sunshine, { textTerms: ['wiseman', 'sunshine'] })).toEqual([]);
        });
        it('is empty for an empty query', () => {
            expect(matchedArtists(sunshine, { textTerms: [] })).toEqual([]);
            expect(matchedArtists(sunshine, {})).toEqual([]);
        });
    });
});
