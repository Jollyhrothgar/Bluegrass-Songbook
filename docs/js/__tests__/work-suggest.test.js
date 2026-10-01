import { describe, it, expect } from 'vitest';
import { findSurvivors, idStem } from '../work-suggest.js';

const songs = [
    { id: 'blue-moon-of-kentucky-1', title: 'Blue Moon Of Kentucky' },
    { id: 'dark-hollow-1', title: 'Dark Hollow' },
    { id: 'dark-hollow-2', title: 'Dark Hollow' },
    { id: 'blue-moon', title: 'Blue Moon' },
    { id: 'other', title: 'Other Song' },
];

describe('findSurvivors', () => {
    it('idStem drops a trailing -N', () => {
        expect(idStem('a-b-1')).toBe('a-b');
        expect(idStem('a-b')).toBe('a-b');
    });
    it('redirects a deleted id with exactly one same-stem same-title survivor', () => {
        const r = findSurvivors('blue-moon-of-kentucky', songs, new Set(['blue-moon-of-kentucky']));
        expect(r.redirect.id).toBe('blue-moon-of-kentucky-1');
    });
    it('accepts the deleted_songs.json object shape', () => {
        const r = findSurvivors('blue-moon-of-kentucky', songs, { 'blue-moon-of-kentucky': {} });
        expect(r.redirect.id).toBe('blue-moon-of-kentucky-1');
    });
    it('suggests but does not redirect when the id is not known deleted', () => {
        const r = findSurvivors('blue-moon-of-kentucky', songs, new Set());
        expect(r.redirect).toBeNull();
        expect(r.suggestions.map(s => s.id)).toEqual(['blue-moon-of-kentucky-1']);
    });
    it('suggests but does not redirect when several survivors match', () => {
        const r = findSurvivors('dark-hollow', songs, new Set(['dark-hollow']));
        expect(r.redirect).toBeNull();
        expect(r.suggestions).toHaveLength(2);
    });
    it('returns nothing for an unrelated id', () => {
        const r = findSurvivors('no-such-thing', songs, new Set());
        expect(r).toEqual({ redirect: null, suggestions: [] });
    });
});
