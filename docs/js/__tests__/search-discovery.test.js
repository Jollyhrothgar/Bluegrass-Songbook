/**
 * robots.txt + sitemap.xml (G2) and the one published contact address (G3).
 *
 * Songs are hash routes (#work/{slug}), which Google treats as one URL, so
 * the sitemap can only list the real pages. Every page it lists must exist
 * and must not be a redirect or noindex page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCS = resolve(__dirname, '../..');
const read = (p) => readFileSync(resolve(DOCS, p), 'utf8');
const ORIGIN = 'https://bluegrassbook.com/';

describe('robots.txt', () => {
    it('allows crawling and names the sitemap', () => {
        const robots = read('robots.txt');
        expect(robots).toMatch(/^User-agent: \*$/m);
        expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
        expect(robots).toMatch(/^Sitemap: https:\/\/bluegrassbook\.com\/sitemap\.xml$/m);
    });
});

describe('sitemap.xml', () => {
    const xml = read('sitemap.xml');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

    it('is a urlset of absolute bluegrassbook.com URLs with no fragments', () => {
        expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
        expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
        expect(locs.length).toBeGreaterThan(0);
        for (const loc of locs) {
            expect(loc.startsWith(ORIGIN)).toBe(true);
            expect(loc).not.toContain('#');
        }
        expect(new Set(locs).size).toBe(locs.length);
    });

    it('lists the home page and only real, indexable pages', () => {
        expect(locs).toContain(ORIGIN);
        for (const loc of locs) {
            const file = loc === ORIGIN ? 'index.html' : loc.slice(ORIGIN.length);
            expect(existsSync(resolve(DOCS, file)), file).toBe(true);
            const html = read(file);
            expect(html, file).not.toMatch(/<meta name="robots" content="noindex">/);
            expect(html, file).not.toMatch(/location\.replace\(/);
        }
    });

    it('leaves out the redirect, the noindex shim and the dev pages', () => {
        for (const page of ['blog.html', 'create.html', 'editor.html', 'editor-demo.html', 'tab-test.html']) {
            expect(locs).not.toContain(ORIGIN + page);
        }
    });
});

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
