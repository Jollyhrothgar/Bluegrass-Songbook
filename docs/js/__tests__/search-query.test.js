import { describe, it, expect } from 'vitest';
import { stripFieldTerms, setFieldTerm, setTagTerms } from '../search-query.js';

// These helpers do string surgery on the search box for the facet chips, the
// Tags dropdown, and the Chords popover. They MUST agree with
// parseSearchQuery's field-value rules or they silently destroy what the user
// typed — `tag:` is a comma list ending at the first space, every other field
// runs to the next prefix.

describe('stripFieldTerms', () => {
    it('removes a tag term without eating trailing free text', () => {
        // Regression: the greedy tag regex deleted "black" from the box the
        // moment you clicked a second facet chip — data loss, no feedback.
        expect(stripFieldTerms('tag:Instrumental black', 'tag')).toBe('black');
        expect(stripFieldTerms('tag:Instrumental,banjo black', 'tag')).toBe('black');
    });

    it('removes a multi-tag comma term including spaces after commas', () => {
        expect(stripFieldTerms('tag:Gospel, Waltz monroe', 'tag')).toBe('monroe');
    });

    it('leaves text before the tag alone', () => {
        expect(stripFieldTerms('black tag:Instrumental', 'tag')).toBe('black');
    });

    it('still consumes a whole multi-word value for non-tag fields', () => {
        expect(stripFieldTerms('artist:hank williams', 'artist')).toBe('');
        expect(stripFieldTerms('monroe artist:hank williams', 'artist')).toBe('monroe');
    });

    it('stops a non-tag field at the next prefix', () => {
        expect(stripFieldTerms('artist:hank williams tag:Gospel', 'artist'))
            .toBe('tag:Gospel');
    });

    it('never touches a negated tag term', () => {
        expect(stripFieldTerms('-tag:Instrumental black', 'tag'))
            .toBe('-tag:Instrumental black');
    });
});

describe('setTagTerms', () => {
    it('preserves typed text when adding another tag', () => {
        // The reported flow: type "black", then click another facet chip.
        expect(setTagTerms('tag:Instrumental,banjo black', ['Instrumental', 'banjo', 'Gospel']))
            .toBe('black tag:Instrumental,banjo,Gospel');
    });

    it('clears the tag term when given no tags', () => {
        expect(setTagTerms('tag:Instrumental black', [])).toBe('black');
    });

    it('writes a comma list', () => {
        expect(setTagTerms('', ['Instrumental', 'banjo'])).toBe('tag:Instrumental,banjo');
    });
});

describe('setFieldTerm', () => {
    it('replaces an existing value', () => {
        expect(setFieldTerm('artist:monroe', 'artist', 'hank williams'))
            .toBe('artist:hank williams');
    });

    it('keeps free text alongside', () => {
        expect(setFieldTerm('black tag:Gospel', 'artist', 'monroe'))
            .toBe('black tag:Gospel artist:monroe');
    });
});
