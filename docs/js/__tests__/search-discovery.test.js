/**
 * robots.txt (G2) and the one published contact address (G3).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCS = resolve(__dirname, '../..');
const read = (p) => readFileSync(resolve(DOCS, p), 'utf8');

describe('robots.txt', () => {
    it('allows crawling and names the sitemap', () => {
        const robots = read('robots.txt');
        expect(robots).toMatch(/^User-agent: \*$/m);
        expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
        expect(robots).toMatch(/^Sitemap: https:\/\/bluegrassbook\.com\/sitemap\.xml$/m);
    });
});

// sitemap.xml is generated with the song pages: tests/test_song_pages.py.

describe('contact address', () => {
    it('is hello@bluegrassbook.com wherever the site publishes one', () => {
        for (const page of ['about.html', 'index.html']) {
            const html = read(page);
            expect(html, page).not.toContain('@gmail.com');
            expect(html, page).toContain('hello@bluegrassbook.com');
        }
        expect(read('index.html')).toContain('href="mailto:hello@bluegrassbook.com"');
    });
});

describe('copyright concern (rights holders)', () => {
    it('builds a mailto to hello@ naming the song and its page', async () => {
        const { copyrightMailto } = await import('../utils.js');
        const url = copyrightMailto({ id: 'rocky-top', title: 'Rocky Top & Friends' });
        expect(url.startsWith('mailto:hello@bluegrassbook.com?')).toBe(true);
        const params = new URLSearchParams(url.split('?')[1]);
        expect(params.get('subject')).toBe('Copyright concern: Rocky Top & Friends');
        expect(params.get('body')).toContain('https://bluegrassbook.com/songs/rocky-top/');
        expect(params.get('body')).toContain('https://bluegrassbook.com/#work/rocky-top');
    });

    it('is in every song page overflow, for every visitor', () => {
        const src = read('js/work-view.js');
        const item = src.indexOf("id: 'copyright-btn'");
        expect(item).toBeGreaterThan(-1);
        // Not inside a role gate: it is pushed before the trusted-only items.
        expect(item).toBeLessThan(src.indexOf("id: 'request-suppress-song-btn'"));
        expect(item).toBeGreaterThan(src.indexOf("id: 'flag-btn'"));
    });
});
