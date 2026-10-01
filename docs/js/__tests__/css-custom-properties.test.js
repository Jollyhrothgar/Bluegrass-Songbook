// Guards against the stylesheet using a custom property nobody defines: a
// var(--x) with no fallback silently drops the whole declaration.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cssDir = join(dirname(fileURLToPath(import.meta.url)), '../../css');
const files = readdirSync(cssDir).filter(f => f.endsWith('.css'));
const sources = files.map(f => [f, readFileSync(join(cssDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]);

// Set at runtime from JS (shell.js, main.js inline style, tablature.js).
const JS_SET = new Set(['--bottomband-h', '--collection-color', '--tab-scale']);

const defined = new Set();
for (const [, css] of sources) {
    for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
}

function luminance(hex) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe('stylesheet custom properties', () => {
    it('every var(--x) without a fallback refers to a defined property', () => {
        const missing = new Map();
        for (const [file, css] of sources) {
            for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
                if (!defined.has(m[1]) && !JS_SET.has(m[1])) {
                    missing.set(m[1], `${file} (${(missing.get(m[1]) || '')})`.trim());
                }
            }
        }
        expect([...missing.keys()]).toEqual([]);
    });
});

describe('text on accent / danger fills', () => {
    const style = sources.find(([f]) => f === 'style.css')[1];
    const block = (sel) => style.match(new RegExp(`(?:^|\\n)${sel}\\s*\\{([^}]*)\\}`))[1];
    const val = (body, name) => body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))[1];
    const light = block(':root');
    const dark = block('\\[data-theme="dark"\\]');

    for (const [theme, body] of [['light', light], ['dark', dark]]) {
        for (const fill of ['accent', 'accent-hover', 'danger', 'danger-hover']) {
            it(`${theme}: --on-${fill.split('-')[0]} on --${fill} is at least 4.5:1`, () => {
                const on = val(body, `--on-${fill.split('-')[0]}`);
                expect(contrast(on, val(body, `--${fill}`))).toBeGreaterThanOrEqual(4.5);
            });
        }
    }
});

describe('no hardcoded white text on accent / danger fills', () => {
    it('uses --on-accent / --on-danger instead of white', () => {
        const offenders = [];
        for (const [file, css] of sources) {
            for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
                const body = m[2];
                const fill = /background(?:-color)?\s*:\s*var\(\s*--(accent|danger|primary|accent-color|accent-hover|danger-hover|danger-dark|primary-dark)\b/.test(body);
                const white = /(?:^|[;\s])color\s*:\s*(white|#fff|#ffffff)\b/i.test(body);
                if (fill && white) offenders.push(`${file}: ${m[1].trim()}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe('children of the danger banner', () => {
    it('do not hardcode white text or white overlays', () => {
        const offenders = [];
        for (const [file, css] of sources) {
            for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
                if (!/\.app-banner-/.test(m[1])) continue;
                if (/(?:^|[;\s])color\s*:\s*(white|#fff|#ffffff)\b|rgba\(\s*255\s*,\s*255\s*,\s*255/i.test(m[2])) {
                    offenders.push(`${file}: ${m[1].trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});

const FILL_RE = /background(?:-color)?\s*:\s*var\(\s*--(accent|danger|primary|accent-color|accent-hover|danger-hover|danger-dark|primary-dark)\b/;
const WHITE_TEXT_RE = /(?:^|[;\s])color\s*:\s*(white|#fff|#ffffff\b|rgba\(\s*255\s*,\s*255\s*,\s*255)/i;

describe('descendants of an accent / danger fill', () => {
    // `.x:hover { background: var(--accent) }` then `.x:hover .y { color: white }`:
    // the per-rule check above cannot see it, because the fill and the text
    // live in different rules.
    it('do not hardcode white text inside a filled ancestor', () => {
        const fills = new Set();
        const rules = [];
        for (const [file, css] of sources) {
            for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
                const selectors = m[1].split(',').map(s => s.trim()).filter(Boolean);
                rules.push({ file, selectors, body: m[2] });
                if (FILL_RE.test(m[2])) selectors.forEach(s => fills.add(s));
            }
        }
        const offenders = [];
        for (const { file, selectors, body } of rules) {
            if (!WHITE_TEXT_RE.test(body)) continue;
            for (const sel of selectors) {
                const ancestor = sel.split(/\s+/).slice(0, -1).join(' ');
                if (ancestor && fills.has(ancestor)) offenders.push(`${file}: ${sel}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe('the tab editor\'s injected CSS', () => {
    // otf-editor builds its stylesheet in JS template strings, outside the
    // css/ directory the checks above read.
    it('uses --on-accent instead of white on accent fills', () => {
        const dir = join(dirname(fileURLToPath(import.meta.url)), '../otf-editor');
        const offenders = [];
        for (const f of readdirSync(dir).filter(n => n.endsWith('.js'))) {
            const src = readFileSync(join(dir, f), 'utf8');
            for (const m of src.matchAll(/([^{}`]+)\{([^{}]*)\}/g)) {
                if (/background(?:-color)?\s*:\s*var\(\s*--accent\b/.test(m[2]) && WHITE_TEXT_RE.test(m[2])) {
                    offenders.push(`${f}: ${m[1].trim().split('\n').pop()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe('dungeon mode accent', () => {
    it('overrides --on-accent so text stays readable on its dark red --accent', () => {
        const css = sources.map(([, c]) => c).join('\n');
        const m = css.match(/body\.dungeon-mode\s*\{([^}]*)\}/);
        expect(m).not.toBeNull();
        const accent = m[1].match(/--accent\s*:\s*(#[0-9a-f]{6})/i)[1];
        const on = m[1].match(/--on-accent\s*:\s*(#[0-9a-f]{6})/i)[1];
        expect(contrast(on, accent)).toBeGreaterThanOrEqual(4.5);
    });
});
