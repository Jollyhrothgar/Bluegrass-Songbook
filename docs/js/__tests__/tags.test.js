// Unit tests for tags.js - Tag categorization, matching, formatting
import { describe, it, expect } from 'vitest';

import {
    TAG_CATEGORIES,
    TAG_DISPLAY_CATEGORIES,
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
