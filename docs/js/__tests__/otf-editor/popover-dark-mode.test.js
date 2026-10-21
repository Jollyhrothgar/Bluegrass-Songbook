/**
 * Every editor popover's plain buttons (Cancel in note entry, Add/Edit text,
 * track name, value prompt) share `.popover-btn`. It set a themed background
 * but no text colour, and a <button> does not inherit `color`: it got the
 * browser's black `buttontext`, invisible on the dark theme's #000.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');

function ruleBody(css, selector) {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
}

describe('editor popover buttons in dark mode', () => {
    it('.popover-btn sets a themed text colour, not the browser default', () => {
        const body = ruleBody(read('js/otf-editor/popover.js'), '.popover-btn');
        expect(body).toMatch(/\n\s*color:\s*var\(--text\b/);
    });

    it('the page declares its colour scheme, so unstyled controls follow the theme', () => {
        const css = read('css/style.css');
        expect(ruleBody(css, ':root')).toMatch(/color-scheme:\s*light/);
        expect(ruleBody(css, '[data-theme="dark"]')).toMatch(/color-scheme:\s*dark/);
    });
});
