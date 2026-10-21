/**
 * blog.html is a redirect to the dev blog's new home on mikebeaumier.com
 * (G1). Old post links were blog.html#<slug>; the fragment never reaches
 * the server, so the page's inline script maps it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCS = resolve(__dirname, '../..');
const html = readFileSync(resolve(DOCS, 'blog.html'), 'utf8');
const SERIES = 'https://mikebeaumier.com/blog/series/bluegrass-book-dev-log/';

function redirectFor(hash) {
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const location = { hash, replace(url) { this.target = url; } };
    new Function('location', script)(location);
    return location.target;
}

describe('blog.html redirect', () => {
    it('sends the bare page to the series page', () => {
        expect(redirectFor('')).toBe(SERIES);
    });

    it('sends every old post link to its new URL', () => {
        const slugs = readdirSync(resolve(DOCS, 'posts'))
            .filter(f => f.endsWith('.md'))
            .map(f => f.slice(0, -3));
        expect(slugs).toHaveLength(8);
        for (const slug of slugs) {
            expect(redirectFor(`#${slug}`)).toBe(`https://mikebeaumier.com/blog/${slug}/`);
        }
    });

    it('sends an unknown fragment to the series page', () => {
        expect(redirectFor('#not-a-post')).toBe(SERIES);
        expect(redirectFor('#../../evil')).toBe(SERIES);
    });

    it('works without JavaScript and names the canonical page', () => {
        expect(html).toMatch(/<noscript><meta http-equiv="refresh" content="0; url=https:\/\/mikebeaumier\.com\/blog\/series\/bluegrass-book-dev-log\/"><\/noscript>/);
        expect(html).toContain(`<link rel="canonical" href="${SERIES}">`);
    });
});

describe('Dev Blog links', () => {
    it('point at the series page', () => {
        const about = readFileSync(resolve(DOCS, 'about.html'), 'utf8');
        const main = readFileSync(resolve(DOCS, 'js/main.js'), 'utf8');
        expect(about).toContain(`<a href="${SERIES}" class="about-link">`);
        expect(main).toContain(`{ label: 'Dev Blog', onClick: () => { location.href = '${SERIES}'; } }`);
        expect(about + main).not.toContain('blog.html');
    });
});
