// Unit tests for collections.js - Collection data integrity
import { describe, it, expect } from 'vitest';

import {
    COLLECTIONS,
    COLLECTION_PINS,
    RELATED_COLLECTIONS,
    getCollectionCount
} from '../collections.js';

describe('COLLECTIONS data integrity', () => {
    it('has 6 collections', () => {
        expect(COLLECTIONS.length).toBe(6);
    });

    it('each collection has required fields', () => {
        for (const col of COLLECTIONS) {
            expect(col.id).toBeTruthy();
            expect(col.title).toBeTruthy();
            expect(col.description).toBeTruthy();
            expect(typeof col.query).toBe('string');
            expect(col.color).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });

    it('collection IDs are unique', () => {
        const ids = COLLECTIONS.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every collection with a query uses tag: prefix', () => {
        for (const col of COLLECTIONS) {
            if (col.query) {
                expect(col.query).toMatch(/^tag:/);
            }
        }
    });

    it('all-songs collection has empty query and isSearchLink flag', () => {
        const allSongs = COLLECTIONS.find(c => c.id === 'all-songs');
        expect(allSongs).toBeTruthy();
        expect(allSongs.query).toBe('');
        expect(allSongs.isSearchLink).toBe(true);
    });
});

describe('COLLECTION_PINS data integrity', () => {
    it('has pins for every collection ID', () => {
        for (const col of COLLECTIONS) {
            expect(COLLECTION_PINS).toHaveProperty(col.id);
        }
    });

    it('all-songs has empty pins array', () => {
        expect(COLLECTION_PINS['all-songs']).toEqual([]);
    });

    it('pin IDs are valid slugs (lowercase, hyphens, no spaces)', () => {
        for (const [, pins] of Object.entries(COLLECTION_PINS)) {
            for (const pin of pins) {
                expect(pin).toMatch(/^[a-z0-9-]+$/);
            }
        }
    });

    it('no duplicate pins within a collection', () => {
        for (const [collectionId, pins] of Object.entries(COLLECTION_PINS)) {
            expect(new Set(pins).size).toBe(pins.length);
        }
    });
});

describe('RELATED_COLLECTIONS', () => {
    it('has at least 1 related collection', () => {
        expect(RELATED_COLLECTIONS.length).toBeGreaterThan(0);
    });

    it('each has required fields', () => {
        for (const col of RELATED_COLLECTIONS) {
            expect(col.id).toBeTruthy();
            expect(col.title).toBeTruthy();
            expect(col.query).toBeTruthy();
        }
    });

    it('IDs do not overlap with main collections', () => {
        const mainIds = new Set(COLLECTIONS.map(c => c.id));
        for (const col of RELATED_COLLECTIONS) {
            expect(mainIds.has(col.id)).toBe(false);
        }
    });
});

describe('getCollectionCount', () => {
    it('returns 0 when allSongs is null', () => {
        expect(getCollectionCount(null, 'tag:Bluegrass', () => [])).toBe(0);
    });

    it('returns 0 when searchFn is null', () => {
        expect(getCollectionCount([], 'tag:Bluegrass', null)).toBe(0);
    });

    it('calls searchFn with query and returns result count', () => {
        const mockSearch = (query, songs) => songs.filter(s => s.tags?.Bluegrass);
        const songs = [
            { id: 'a', tags: { Bluegrass: { score: 80 } } },
            { id: 'b', tags: { Gospel: { score: 80 } } },
            { id: 'c', tags: { Bluegrass: { score: 50 } } }
        ];
        expect(getCollectionCount(songs, 'tag:Bluegrass', mockSearch)).toBe(2);
    });
});
