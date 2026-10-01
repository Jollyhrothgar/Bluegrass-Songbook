import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { COLLECTION_THUMBNAILS, collectionThumbnailHtml } from '../collections.js';

const docs = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('collection thumbnails', () => {
    it('every thumbnail exists, is small WebP, and has dimensions', () => {
        for (const [id, t] of Object.entries(COLLECTION_THUMBNAILS)) {
            const f = resolve(docs, t.src);
            expect(existsSync(f), id).toBe(true);
            expect(t.src.endsWith('.webp')).toBe(true);
            expect(statSync(f).size).toBeLessThan(20 * 1024);
            expect(t.w).toBe(160);
            expect(t.h).toBeGreaterThan(0);
        }
    });

    it('emits lazy, async, sized markup', () => {
        const html = collectionThumbnailHtml('all-songs', 'All Songs');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('decoding="async"');
        expect(html).toContain('width="160"');
        expect(html).toContain('height="162"');
        expect(html).toContain('alt="All Songs"');
    });

    it('returns empty string for collections without a thumbnail', () => {
        expect(collectionThumbnailHtml('old-time', 'x')).toBe('');
    });
});
