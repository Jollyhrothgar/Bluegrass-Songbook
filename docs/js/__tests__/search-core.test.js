// Unit tests for search-core.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../state.js', () => ({
    allSongs: [],
    songGroups: {}
}));

vi.mock('../utils.js', () => ({
    highlightMatch: vi.fn((text) => text)
}));

vi.mock('../tags.js', () => ({
    songHasTags: vi.fn(() => true),
    getTagCategory: vi.fn(() => 'genre'),
    formatTagName: vi.fn((tag) => tag)
}));

vi.mock('../lists.js', () => ({
    isFavorite: vi.fn(() => false),
    reorderFavoriteItem: vi.fn(),
    showFavorites: vi.fn(),
    isSongInAnyList: vi.fn(() => false),
    showResultListPicker: vi.fn(),
    getViewingListId: vi.fn(() => null),
    reorderSongInList: vi.fn(),
    isViewingOwnList: vi.fn(() => false)
}));

vi.mock('../song-view.js', () => ({
    openSong: vi.fn(),
    showVersionPicker: vi.fn()
}));

vi.mock('../analytics.js', () => ({
    trackSearch: vi.fn(),
    trackSearchResultClick: vi.fn()
}));

import {
    parseSearchQuery,
    songHasChords,
    songHasProgression
} from '../search-core.js';

describe('parseSearchQuery', () => {
    describe('text terms', () => {
        it('parses simple text query', () => {
            const result = parseSearchQuery('blue moon');
            expect(result.textTerms).toEqual(['blue', 'moon']);
        });

        it('converts text to lowercase', () => {
            const result = parseSearchQuery('Blue MOON');
            expect(result.textTerms).toEqual(['blue', 'moon']);
        });

        it('handles empty query', () => {
            const result = parseSearchQuery('');
            expect(result.textTerms).toEqual([]);
        });
    });

    describe('artist filter', () => {
        it('parses artist filter', () => {
            const result = parseSearchQuery('artist:hank');
            expect(result.artistFilter).toBe('hank');
        });

        it('parses multi-word artist', () => {
            const result = parseSearchQuery('artist:hank williams');
            expect(result.artistFilter).toBe('hank williams');
        });

        it('parses artist shorthand a:', () => {
            const result = parseSearchQuery('a:bill monroe');
            expect(result.artistFilter).toBe('bill monroe');
        });

        it('parses artist with other terms', () => {
            const result = parseSearchQuery('cheatin artist:hank williams');
            expect(result.textTerms).toEqual(['cheatin']);
            expect(result.artistFilter).toBe('hank williams');
        });
    });

    describe('title filter', () => {
        it('parses title filter', () => {
            const result = parseSearchQuery('title:blue moon');
            expect(result.titleFilter).toBe('blue moon');
        });
    });

    describe('lyrics filter', () => {
        it('parses lyrics filter', () => {
            const result = parseSearchQuery('lyrics:lonesome highway');
            expect(result.lyricsFilter).toBe('lonesome highway');
        });

        it('parses lyrics shorthand l:', () => {
            const result = parseSearchQuery('l:drinking');
            expect(result.lyricsFilter).toBe('drinking');
        });
    });

    describe('composer filter', () => {
        it('parses composer filter', () => {
            const result = parseSearchQuery('composer:bill monroe');
            expect(result.composerFilter).toBe('bill monroe');
        });

        it('parses writer alias', () => {
            const result = parseSearchQuery('writer:hank williams');
            expect(result.composerFilter).toBe('hank williams');
        });
    });

    describe('key filter', () => {
        it('parses key filter', () => {
            const result = parseSearchQuery('key:G');
            expect(result.keyFilter).toBe('G');
        });

        it('normalizes key to uppercase', () => {
            const result = parseSearchQuery('key:g');
            expect(result.keyFilter).toBe('G');
        });

        it('parses key shorthand k:', () => {
            const result = parseSearchQuery('k:Am');
            expect(result.keyFilter).toBe('AM');
        });
    });

    describe('chord filter', () => {
        it('parses single chord', () => {
            const result = parseSearchQuery('chord:VII');
            expect(result.chordFilters).toEqual(['VII']);
        });

        it('parses multiple chords', () => {
            const result = parseSearchQuery('chord:VII,II');
            expect(result.chordFilters).toEqual(['VII', 'II']);
        });

        it('parses chord shorthand c:', () => {
            const result = parseSearchQuery('c:V');
            expect(result.chordFilters).toEqual(['V']);
        });
    });

    describe('progression filter', () => {
        it('parses progression', () => {
            const result = parseSearchQuery('prog:I-IV-V');
            expect(result.progressionFilter).toEqual(['I', 'IV', 'V']);
        });

        it('parses progression shorthand p:', () => {
            const result = parseSearchQuery('p:ii-V-I');
            expect(result.progressionFilter).toEqual(['ii', 'V', 'I']);
        });
    });

    describe('tag filter', () => {
        it('parses single tag', () => {
            const result = parseSearchQuery('tag:bluegrass');
            expect(result.tagFilters).toEqual(['bluegrass']);
        });

        it('parses multiple tags', () => {
            const result = parseSearchQuery('tag:bluegrass,gospel');
            expect(result.tagFilters).toEqual(['bluegrass', 'gospel']);
        });

        it('parses tag shorthand t:', () => {
            const result = parseSearchQuery('t:jamfriendly');
            expect(result.tagFilters).toEqual(['jamfriendly']);
        });
    });

    describe('negative filters', () => {
        it('parses negative artist', () => {
            const result = parseSearchQuery('-artist:hank');
            expect(result.excludeArtist).toBe('hank');
        });

        it('parses negative title', () => {
            const result = parseSearchQuery('-title:drinking');
            expect(result.excludeTitle).toBe('drinking');
        });

        it('parses negative lyrics', () => {
            const result = parseSearchQuery('-lyrics:sad');
            expect(result.excludeLyrics).toBe('sad');
        });

        it('parses negative key', () => {
            const result = parseSearchQuery('-key:C');
            expect(result.excludeKey).toBe('C');
        });

        it('parses negative tag', () => {
            const result = parseSearchQuery('-tag:instrumental');
            expect(result.excludeTags).toEqual(['instrumental']);
        });

        it('parses negative chords', () => {
            const result = parseSearchQuery('-chord:VII');
            expect(result.excludeChords).toEqual(['VII']);
        });
    });

    describe('combined filters', () => {
        it('parses multiple filters', () => {
            const result = parseSearchQuery('artist:hank tag:honkytonk chord:VII');
            expect(result.artistFilter).toBe('hank');
            expect(result.tagFilters).toEqual(['honkytonk']);
            expect(result.chordFilters).toEqual(['VII']);
        });

        it('parses text with filters', () => {
            const result = parseSearchQuery('cheatin heart artist:hank williams tag:classic');
            expect(result.textTerms).toEqual(['cheatin', 'heart']);
            expect(result.artistFilter).toBe('hank williams');
            expect(result.tagFilters).toEqual(['classic']);
        });

        it('parses inclusion and exclusion together', () => {
            const result = parseSearchQuery('tag:bluegrass -tag:instrumental');
            expect(result.tagFilters).toEqual(['bluegrass']);
            expect(result.excludeTags).toEqual(['instrumental']);
        });
    });
});

describe('songHasChords', () => {
    it('returns true for song with all required chords', () => {
        const song = { nashville: ['I', 'IV', 'V', 'VII'] };
        expect(songHasChords(song, ['VII'])).toBe(true);
        expect(songHasChords(song, ['I', 'V'])).toBe(true);
    });

    it('returns false when missing required chord', () => {
        const song = { nashville: ['I', 'IV', 'V'] };
        expect(songHasChords(song, ['VII'])).toBe(false);
        expect(songHasChords(song, ['I', 'VII'])).toBe(false);
    });

    it('returns true for empty required chords', () => {
        const song = { nashville: ['I', 'IV', 'V'] };
        expect(songHasChords(song, [])).toBe(true);
    });

    it('returns false for song with no chords', () => {
        const song = { nashville: [] };
        expect(songHasChords(song, ['I'])).toBe(false);
    });

    it('handles missing nashville array', () => {
        const song = {};
        expect(songHasChords(song, ['I'])).toBe(false);
    });
});

describe('songHasProgression', () => {
    it('finds progression at start', () => {
        const song = { progression: ['I', 'IV', 'V', 'I', 'vi', 'IV'] };
        expect(songHasProgression(song, ['I', 'IV', 'V'])).toBe(true);
    });

    it('finds progression in middle', () => {
        const song = { progression: ['I', 'IV', 'V', 'ii', 'V', 'I'] };
        expect(songHasProgression(song, ['ii', 'V', 'I'])).toBe(true);
    });

    it('returns false when progression not found', () => {
        const song = { progression: ['I', 'IV', 'V', 'I'] };
        expect(songHasProgression(song, ['ii', 'V', 'I'])).toBe(false);
    });

    it('returns true for empty progression filter', () => {
        const song = { progression: ['I', 'IV', 'V'] };
        expect(songHasProgression(song, [])).toBe(true);
        expect(songHasProgression(song, null)).toBe(true);
    });

    it('returns false for song with no progression', () => {
        const song = { progression: [] };
        expect(songHasProgression(song, ['I', 'IV', 'V'])).toBe(false);
    });

    it('handles missing progression array', () => {
        const song = {};
        expect(songHasProgression(song, ['I', 'IV'])).toBe(false);
    });

    it('matches exact sequence order', () => {
        const song = { progression: ['I', 'V', 'IV'] };
        // I-IV-V not found because order is wrong
        expect(songHasProgression(song, ['I', 'IV', 'V'])).toBe(false);
    });
});
