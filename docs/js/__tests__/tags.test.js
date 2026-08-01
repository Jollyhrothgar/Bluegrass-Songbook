// Unit tests for tags.js - Tag categorization, matching, formatting
import { describe, it, expect } from 'vitest';

import {
    TAG_CATEGORIES,
    TAG_DISPLAY_CATEGORIES,
    INSTRUMENT_FACETS,
    getTagCategory,
    formatTagName,
    getInstrumentTags,
    songHasTags,
    renderTagBadges
} from '../tags.js';

describe('getTagCategory', () => {
    it('returns genre for genre tags', () => {
        expect(getTagCategory('Bluegrass')).toBe('genre');
        expect(getTagCategory('ClassicCountry')).toBe('genre');
        expect(getTagCategory('Gospel')).toBe('genre');
        expect(getTagCategory('OldTime')).toBe('genre');
        expect(getTagCategory('HonkyTonk')).toBe('genre');
        expect(getTagCategory('Outlaw')).toBe('genre');
        expect(getTagCategory('WesternSwing')).toBe('genre');
    });

    it('returns structure for structure tags', () => {
        expect(getTagCategory('Instrumental')).toBe('structure');
        expect(getTagCategory('Waltz')).toBe('structure');
    });

    it('returns vibe for vibe tags', () => {
        expect(getTagCategory('JamFriendly')).toBe('vibe');
        expect(getTagCategory('Modal')).toBe('vibe');
    });

    it('returns instrument for instrument tags', () => {
        expect(getTagCategory('banjo')).toBe('instrument');
        expect(getTagCategory('fiddle')).toBe('instrument');
        expect(getTagCategory('guitar')).toBe('instrument');
    });

    it('returns other for unknown tags', () => {
        expect(getTagCategory('SomeRandomTag')).toBe('other');
        expect(getTagCategory('')).toBe('other');
    });
});

describe('formatTagName', () => {
    it('converts CamelCase to readable format', () => {
        expect(formatTagName('ClassicCountry')).toBe('Classic Country');
        expect(formatTagName('JamFriendly')).toBe('Jam Friendly');
        expect(formatTagName('WesternSwing')).toBe('Western Swing');
        expect(formatTagName('NashvilleSound')).toBe('Nashville Sound');
    });

    it('preserves single-word tags', () => {
        expect(formatTagName('Bluegrass')).toBe('Bluegrass');
        expect(formatTagName('Gospel')).toBe('Gospel');
    });

    it('handles all-lowercase tags', () => {
        expect(formatTagName('banjo')).toBe('banjo');
        expect(formatTagName('fiddle')).toBe('fiddle');
    });

    it('handles multi-capital tags', () => {
        expect(formatTagName('OldTime')).toBe('Old Time');
    });
});

describe('getInstrumentTags', () => {
    it('returns empty array for song without tabs', () => {
        expect(getInstrumentTags({ id: 'test' })).toEqual([]);
    });

    it('extracts instruments from tablature_parts', () => {
        const song = {
            tablature_parts: [
                { instrument: 'banjo' },
                { instrument: '5-string-banjo' }
            ]
        };
        const tags = getInstrumentTags(song);
        expect(tags).toContain('banjo');
        expect(tags).toContain('5-string-banjo');
    });

    it('deduplicates instrument tags', () => {
        const song = {
            tablature_parts: [
                { instrument: 'Banjo' },
                { instrument: 'banjo' }
            ]
        };
        const tags = getInstrumentTags(song);
        expect(tags.length).toBe(1);
    });

    it('detects fiddle from ABC notation in content', () => {
        const song = {
            content: '{start_of_abc}\nX:1\nT:Test\n{end_of_abc}'
        };
        const tags = getInstrumentTags(song);
        expect(tags).toContain('fiddle');
    });

    it('does not add fiddle for content without ABC', () => {
        const song = {
            content: '{meta: title Test}\n[G]Hello world'
        };
        const tags = getInstrumentTags(song);
        expect(tags).not.toContain('fiddle');
    });

    // --- lean index: derived from flags + part metadata ---

    it('adds the instrument FAMILY alongside the raw spelling', () => {
        const tags = getInstrumentTags({
            tablature_parts: [{ instrument: '5-string-banjo' }, { instrument: 'upright-bass' }]
        });
        expect(tags).toContain('5-string-banjo');
        expect(tags).toContain('banjo');
        expect(tags).toContain('upright-bass');
        expect(tags).toContain('bass');
    });

    it('treats a tenor banjo as both tenor-banjo and banjo', () => {
        const tags = getInstrumentTags({ tablature_parts: [{ instrument: 'tenor-banjo' }] });
        expect(tags).toContain('tenor-banjo');
        expect(tags).toContain('banjo');
    });

    it('has_abc yields BOTH fiddle and notation', () => {
        const tags = getInstrumentTags({ id: 'red-haired-boy', has_abc: true });
        expect(tags).toContain('fiddle');
        expect(tags).toContain('notation');
    });

    it('legacy abc_content yields fiddle and notation too', () => {
        const tags = getInstrumentTags({ id: 'x', abc_content: 'X:1\nT:Tune\n' });
        expect(tags).toEqual(expect.arrayContaining(['fiddle', 'notation']));
    });

    it('a part with more than one track yields multipart', () => {
        const tags = getInstrumentTags({
            tablature_parts: [{ instrument: 'guitar', tracks: 4 }]
        });
        expect(tags).toContain('multipart');
        expect(tags).toContain('guitar');
    });

    it('a single-track part is not multipart', () => {
        const tags = getInstrumentTags({
            tablature_parts: [{ instrument: 'banjo', tracks: 1 }]
        });
        expect(tags).not.toContain('multipart');
    });

    it('an ensemble part is multipart even without a track count', () => {
        const tags = getInstrumentTags({ tablature_parts: [{ instrument: 'ensemble' }] });
        expect(tags).toContain('multipart');
    });

    it('a plain lyrics-and-chords work has no instrument tags', () => {
        expect(getInstrumentTags({ id: 'x', has_content: true })).toEqual([]);
    });

    it('tolerates a null song', () => {
        expect(getInstrumentTags(null)).toEqual([]);
    });
});

describe('INSTRUMENT_FACETS', () => {
    it('every facet tag is categorized as an instrument', () => {
        for (const { tag } of INSTRUMENT_FACETS) {
            expect(TAG_CATEGORIES[tag]).toBe('instrument');
        }
    });

    it('every facet has a display label', () => {
        for (const facet of INSTRUMENT_FACETS) {
            expect(facet.label.length).toBeGreaterThan(0);
        }
    });

    it('is what the Instruments dropdown group offers', () => {
        expect(TAG_DISPLAY_CATEGORIES.Instruments)
            .toEqual(INSTRUMENT_FACETS.map(f => f.tag));
    });
});

describe('songHasTags', () => {
    const song = {
        tags: {
            'Bluegrass': { score: 80 },
            'JamFriendly': { score: 50 },
            'Gospel': { score: 80 }
        },
        tablature_parts: [{ instrument: 'banjo' }]
    };

    it('returns true for empty required tags', () => {
        expect(songHasTags(song, [])).toBe(true);
    });

    it('matches exact tag names', () => {
        expect(songHasTags(song, ['Bluegrass'])).toBe(true);
        expect(songHasTags(song, ['Bluegrass', 'Gospel'])).toBe(true);
    });

    it('matches case-insensitively', () => {
        expect(songHasTags(song, ['bluegrass'])).toBe(true);
        expect(songHasTags(song, ['BLUEGRASS'])).toBe(true);
    });

    it('normalizes spaces, underscores, hyphens', () => {
        expect(songHasTags(song, ['jam friendly'])).toBe(true);
        expect(songHasTags(song, ['jam_friendly'])).toBe(true);
        expect(songHasTags(song, ['jam-friendly'])).toBe(true);
    });

    it('uses prefix matching', () => {
        expect(songHasTags(song, ['blue'])).toBe(true); // "blue" matches "bluegrass"
        expect(songHasTags(song, ['jam'])).toBe(true);   // "jam" matches "jamfriendly"
    });

    it('returns false when tag not present', () => {
        expect(songHasTags(song, ['HonkyTonk'])).toBe(false);
        expect(songHasTags(song, ['Bluegrass', 'HonkyTonk'])).toBe(false); // All must match
    });

    it('includes instrument tags from tablature_parts', () => {
        expect(songHasTags(song, ['banjo'])).toBe(true);
    });

    it('matches virtual instrument tags case- and separator-insensitively', () => {
        const tabbed = {
            tags: {},
            tablature_parts: [{ instrument: '5-string-Banjo', tracks: 3 }],
        };
        expect(songHasTags(tabbed, ['banjo'])).toBe(true);
        expect(songHasTags(tabbed, ['BANJO'])).toBe(true);
        expect(songHasTags(tabbed, ['multipart'])).toBe(true);
        expect(songHasTags(tabbed, ['Multipart'])).toBe(true);
        expect(songHasTags(tabbed, ['mandolin'])).toBe(false);
    });

    it('matches tag:notation and tag:fiddle on ABC works', () => {
        const abc = { tags: {}, has_abc: true };
        expect(songHasTags(abc, ['notation'])).toBe(true);
        expect(songHasTags(abc, ['fiddle'])).toBe(true);
        expect(songHasTags(abc, ['banjo'])).toBe(false);
    });

    it('matches a hyphenated instrument typed with any separator', () => {
        const tenor = { tags: {}, tablature_parts: [{ instrument: 'tenor-banjo' }] };
        expect(songHasTags(tenor, ['tenor-banjo'])).toBe(true);
        expect(songHasTags(tenor, ['tenor banjo'])).toBe(true);
        expect(songHasTags(tenor, ['tenor_banjo'])).toBe(true);
    });

    it('handles song with no tags gracefully', () => {
        expect(songHasTags({ id: 'test' }, ['Bluegrass'])).toBe(false);
    });
});

describe('renderTagBadges', () => {
    it('returns empty string for song with no tags', () => {
        expect(renderTagBadges({ tags: {} })).toBe('');
        expect(renderTagBadges({})).toBe('');
    });

    it('generates HTML with correct CSS classes', () => {
        const song = { tags: { 'Bluegrass': { score: 80 } } };
        const html = renderTagBadges(song);
        expect(html).toContain('tag-genre');
        expect(html).toContain('Bluegrass');
        expect(html).toContain('tag-badge');
    });

    it('applies category-specific CSS classes', () => {
        const song = { tags: {
            'JamFriendly': { score: 50 },
            'Instrumental': { score: 80 },
            'Bluegrass': { score: 80 }
        }};
        const html = renderTagBadges(song);
        expect(html).toContain('tag-vibe');
        expect(html).toContain('tag-structure');
        expect(html).toContain('tag-genre');
    });

    it('formats CamelCase tags for display', () => {
        const song = { tags: { 'ClassicCountry': { score: 80 } } };
        const html = renderTagBadges(song);
        expect(html).toContain('Classic Country');
    });

    it('adds clickable class when onClick provided', () => {
        const song = { tags: { 'Bluegrass': { score: 80 } } };
        const html = renderTagBadges(song, 'handleTagClick');
        expect(html).toContain('clickable');
        expect(html).toContain('handleTagClick');
    });
});

describe('TAG_CATEGORIES completeness', () => {
    it('has all display categories mapped', () => {
        for (const [, tags] of Object.entries(TAG_DISPLAY_CATEGORIES)) {
            for (const tag of tags) {
                expect(TAG_CATEGORIES[tag]).toBeDefined();
            }
        }
    });
});
