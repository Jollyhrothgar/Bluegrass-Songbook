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
